import { footer } from "@/content/site";
import type { JsonLdNode } from "./types";

/**
 * schema.org nodes for the marketing site.
 *
 * Every builder takes an absolute `origin` rather than reading one from the
 * document, because these run on the server as well as in the browser and a
 * relative `@id` is not a stable identifier — two pages would claim to describe
 * two different organisations.
 */

/** The `@id` every other node points back at, so the graph has one publisher. */
export const ORGANIZATION_ID = "#organization";
export const PERSON_ID = "#person";
export const WEBSITE_ID = "#website";

const LOGO_PATH = "/images/boss-clinician-logo.png";
const PORTRAIT_PATH = "/images/yvette-hero-portrait.jpg";

/** Site-relative paths become absolute; absolute URLs are left alone. */
export function absoluteUrl(origin: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${origin}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

/** The profiles Google uses to reconcile a brand with its social accounts. */
function sameAs(): string[] {
  return [footer.instagram, footer.facebook, footer.threads].filter(
    (url): url is string => typeof url === "string" && url.length > 0,
  );
}

export function organizationNode(origin: string): JsonLdNode {
  return {
    "@type": "Organization",
    "@id": `${origin}/${ORGANIZATION_ID}`,
    name: "Boss Clinician",
    legalName: "Boss Clinician, LLC",
    url: `${origin}/`,
    email: footer.contactEmail,
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl(origin, LOGO_PATH),
    },
    description:
      "Business strategy, credentialing and documentation training for therapists and healthcare clinicians building private practices.",
    founder: { "@id": `${origin}/${PERSON_ID}` },
    sameAs: sameAs(),
  };
}

export function personNode(origin: string): JsonLdNode {
  return {
    "@type": "Person",
    "@id": `${origin}/${PERSON_ID}`,
    name: "Yvette Howard",
    honorificSuffix: "LCSW",
    jobTitle: "Private Practice Strategist",
    url: `${origin}/about`,
    image: absoluteUrl(origin, PORTRAIT_PATH),
    worksFor: { "@id": `${origin}/${ORGANIZATION_ID}` },
    sameAs: sameAs(),
  };
}

export function webSiteNode(origin: string): JsonLdNode {
  return {
    "@type": "WebSite",
    "@id": `${origin}/${WEBSITE_ID}`,
    url: `${origin}/`,
    name: "Boss Clinician",
    publisher: { "@id": `${origin}/${ORGANIZATION_ID}` },
  };
}

export interface ArticleSchemaInput {
  title: string;
  description: string;
  slug: string;
  coverImage?: string;
  author?: string;
  publishedAt?: string | null;
  updatedAt?: string | null;
  tags?: string[];
  wordCount?: number;
}

export function articleNode(origin: string, input: ArticleSchemaInput): JsonLdNode {
  const url = `${origin}/blog/${input.slug}`;
  return {
    "@type": "Article",
    "@id": `${url}#article`,
    headline: input.title,
    description: input.description,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    ...(input.coverImage ? { image: absoluteUrl(origin, input.coverImage) } : {}),
    // The byline is a name on a row, so it is a Person node of its own rather
    // than a reference to Yvette — a guest post must not be attributed to her.
    author: { "@type": "Person", name: input.author || "Yvette Howard" },
    publisher: { "@id": `${origin}/${ORGANIZATION_ID}` },
    ...(input.publishedAt ? { datePublished: new Date(input.publishedAt).toISOString() } : {}),
    ...(input.updatedAt ? { dateModified: new Date(input.updatedAt).toISOString() } : {}),
    ...(input.tags && input.tags.length > 0 ? { keywords: input.tags.join(", ") } : {}),
    ...(input.wordCount ? { wordCount: input.wordCount } : {}),
    inLanguage: "en-US",
  };
}

export interface CourseOfferInput {
  slug: string;
  amountCents: number;
  currency: string;
  pricingType: "one_time" | "subscription" | "payment_plan" | "free" | "pwyw";
  installmentCount?: number | null;
}

export interface CourseSchemaInput {
  title: string;
  description: string;
  slug: string;
  image?: string;
  offers?: CourseOfferInput[];
  lessonCount?: number;
  totalMinutes?: number;
}

/**
 * `Offer` price for a course.
 *
 * A payment plan is priced at its total, not at one instalment: the instalment
 * is what leaves the card each month, but the total is what the buyer pays and
 * therefore what a shopping result has to show. "Pay what you can" has no
 * fixed price at all, so it is offered without one rather than at zero.
 */
function offerNode(origin: string, courseSlug: string, offer: CourseOfferInput): JsonLdNode {
  const currency = (offer.currency || "usd").toUpperCase();
  const total =
    offer.pricingType === "payment_plan"
      ? offer.amountCents * (offer.installmentCount ?? 1)
      : offer.amountCents;

  return {
    "@type": "Offer",
    url: `${origin}/checkout/${offer.slug}`,
    availability: "https://schema.org/InStock",
    category: offer.pricingType === "subscription" ? "Subscription" : "Purchase",
    priceCurrency: currency,
    ...(offer.pricingType === "pwyw" ? {} : { price: (total / 100).toFixed(2) }),
    seller: { "@id": `${origin}/${ORGANIZATION_ID}` },
    itemOffered: { "@id": `${origin}/courses/${courseSlug}#course` },
  };
}

export function courseNode(origin: string, input: CourseSchemaInput): JsonLdNode {
  const url = `${origin}/courses/${input.slug}`;
  const offers = (input.offers ?? []).map((o) => offerNode(origin, input.slug, o));

  return {
    "@type": "Course",
    "@id": `${url}#course`,
    name: input.title,
    description: input.description,
    url,
    ...(input.image ? { image: absoluteUrl(origin, input.image) } : {}),
    provider: { "@id": `${origin}/${ORGANIZATION_ID}` },
    inLanguage: "en-US",
    // Self-paced online material with no scheduled cohort. Google rejects a
    // Course without this block, so it is stated rather than left implied.
    hasCourseInstance: {
      "@type": "CourseInstance",
      courseMode: "online",
      courseWorkload: workloadDuration(input.totalMinutes),
      instructor: { "@id": `${origin}/${PERSON_ID}` },
    },
    ...(offers.length > 0 ? { offers } : {}),
  };
}

/** ISO 8601 duration. Google reads `courseWorkload` and nothing else here. */
function workloadDuration(totalMinutes?: number): string {
  const minutes = Math.max(1, Math.round(totalMinutes ?? 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `PT${hours > 0 ? `${hours}H` : ""}${rest > 0 || hours === 0 ? `${rest || minutes}M` : ""}`;
}

/**
 * The `Product` twin of a course.
 *
 * A course is also a thing with a price, and merchant results are driven by
 * Product/Offer rather than Course/Offer. Both are emitted for a sales page;
 * they describe the same URL from two vocabularies, which is what Google's own
 * guidance asks for when a page is genuinely both.
 */
export function productNode(origin: string, input: CourseSchemaInput): JsonLdNode {
  const url = `${origin}/courses/${input.slug}`;
  const offers = (input.offers ?? []).map((o) => offerNode(origin, input.slug, o));

  return {
    "@type": "Product",
    "@id": `${url}#product`,
    name: input.title,
    description: input.description,
    url,
    ...(input.image ? { image: absoluteUrl(origin, input.image) } : {}),
    brand: { "@id": `${origin}/${ORGANIZATION_ID}` },
    ...(offers.length > 0 ? { offers } : {}),
  };
}

export interface FaqEntry {
  q: string;
  a: string;
}

export function faqPageNode(origin: string, path: string, faqs: readonly FaqEntry[]): JsonLdNode {
  return {
    "@type": "FAQPage",
    "@id": `${origin}${path}#faq`,
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };
}

export interface BreadcrumbStep {
  name: string;
  path: string;
}

export function breadcrumbNode(origin: string, steps: readonly BreadcrumbStep[]): JsonLdNode {
  return {
    "@type": "BreadcrumbList",
    itemListElement: steps.map((step, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: step.name,
      item: `${origin}${step.path}`,
    })),
  };
}
