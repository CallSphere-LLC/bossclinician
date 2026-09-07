import { ContentImage, ContentMap, ContentPage, ContentText } from "./contentLoader";

const NAV_LINKS = new Set([
  "ABOUT YVETTE",
  "WORK WITH ME",
  "COURSES",
  "FREE RESOURCES",
  "RETREATS",
  "BLOG",
]);

const LEGAL_LINKS = new Set([
  "Financial Disclaimer",
  "Privacy Policy",
  "Terms of Use",
  "Disclaimer",
  "Terms of Service",
]);

const FOOTER_MARKER = "We hate SPAM. We will never sell your information, for any reason.";

function skipLeadingNav(texts: ContentText[]): number {
  let i = 0;
  while (i < texts.length && texts[i].tag === "a" && NAV_LINKS.has(texts[i].text.trim())) {
    i++;
  }
  return i;
}

function isSoftCta(t: ContentText): boolean {
  const s = t.text.toLowerCase();
  return (
    /need more support/.test(s) ||
    /work with me/.test(s) ||
    /ready to build a private practice/.test(s)
  );
}

export interface BlogSeed {
  slug: string;
  title: string;
  excerpt: string;
  bodyMd: string;
  coverImage: string | null;
  tags: string[];
  author: string;
  readMinutes: number;
  published: boolean;
}

function slugFromUrl(url: string | undefined, fallbackKey: string): string {
  if (url) {
    const match = url.match(/\/blog\/([^/?#]+)/);
    if (match) return match[1];
  }
  return fallbackKey.replace(/^blog_/, "");
}

function renderMarkdown(texts: ContentText[]): string {
  const lines: string[] = [];
  for (const t of texts) {
    const text = t.text.trim();
    if (!text) continue;
    switch (t.tag) {
      case "h1":
        lines.push(`# ${text}`);
        break;
      case "h2":
        lines.push(`## ${text}`);
        break;
      case "h3":
        lines.push(`### ${text}`);
        break;
      case "h4":
        lines.push(`#### ${text}`);
        break;
      case "li":
        lines.push(`- ${text}`);
        break;
      case "blockquote":
        lines.push(`> ${text}`);
        break;
      case "a":
        lines.push(`**${text}**`);
        break;
      default:
        lines.push(text);
    }
  }
  return lines.join("\n\n").trim();
}

export function extractBlogPost(key: string, page: ContentPage): BlogSeed {
  const texts = page.texts;
  let i = skipLeadingNav(texts);

  // Find the article's real h1 (post title).
  while (i < texts.length && texts[i].tag !== "h1") i++;
  const title = i < texts.length ? texts[i].text.trim() : page.title;
  i++;

  // Category/tag links immediately following the h1 (skip stray CTA anchors like
  // "Apply to work with me" that occasionally sit in the same run when a post has
  // no body copy in the scrape).
  const tags: string[] = [];
  while (i < texts.length && texts[i].tag === "a" && !NAV_LINKS.has(texts[i].text.trim())) {
    const raw = texts[i].text.trim();
    if (!/apply|work with me|watch|register|download|subscribe/i.test(raw)) {
      tags.push(raw.toLowerCase());
    }
    i++;
  }

  const bodyStart = i;
  let bodyEnd = texts.findIndex((t, idx) => idx >= bodyStart && t.text.trim() === FOOTER_MARKER);
  if (bodyEnd === -1) bodyEnd = texts.length;
  while (bodyEnd > bodyStart && isSoftCta(texts[bodyEnd - 1])) bodyEnd--;

  const bodyTexts = texts.slice(bodyStart, bodyEnd);
  const firstParagraph = bodyTexts.find((t) => t.tag === "p");
  const excerpt = (firstParagraph?.text ?? page.description).trim();
  // Some scraped posts have no body copy at all (source page loaded content the
  // scraper couldn't capture) — fall back to the page description so the post
  // still renders something instead of an empty article.
  const bodyMd = renderMarkdown(bodyTexts) || page.description.trim();

  const wordCount = bodyMd.split(/\s+/).filter(Boolean).length;
  const readMinutes = Math.max(3, Math.round(wordCount / 200));

  const coverImage = page.images[1]?.src ?? page.images[0]?.src ?? null;

  return {
    slug: slugFromUrl(page.url, key),
    title,
    excerpt,
    bodyMd,
    coverImage,
    tags: tags.length > 0 ? Array.from(new Set(tags)) : ["private practice", "therapists"],
    author: "Yvette Howard, LCSW",
    readMinutes,
    published: true,
  };
}

export interface TestimonialSeed {
  name: string;
  credential: string;
  quote: string;
  image: string | null;
  sort: number;
}

/** Home page lists three quote/name pairs as consecutive <p> tags. */
export function extractTestimonials(home: ContentPage): TestimonialSeed[] {
  const texts = home.texts;
  const results: TestimonialSeed[] = [];

  // Fall back to the well-known set documented in brand.md if pattern matching finds nothing.
  const fallbackImages = ["/images/f48662c2e2cf.png", "/images/a9f02fa658eb.png", "/images/5227d6258979.png"];
  const imagePool = home.images.filter((im) => /success story|testimonial/i.test(im.alt)).map((im) => im.src);
  const images = imagePool.length >= 3 ? imagePool : fallbackImages;

  for (let idx = 0; idx < texts.length - 1; idx++) {
    const quote = texts[idx];
    const nameLine = texts[idx + 1];
    if (
      quote.tag === "p" &&
      nameLine.tag === "p" &&
      quote.text.trim().startsWith('"') &&
      /^[A-Z][a-zA-Z.]*\s[A-Z][a-zA-Z.]*\s?(LCSW|LPC|LMFT|LMHC)?\.?$/.test(nameLine.text.trim())
    ) {
      const nameParts = nameLine.text.trim().split(/\s+/);
      const credential = nameParts[nameParts.length - 1];
      const name = nameParts.slice(0, -1).join(" ");
      results.push({
        name,
        credential,
        quote: quote.text.trim().replace(/^"|"$/g, ""),
        image: images[results.length] ?? null,
        sort: results.length,
      });
    }
  }

  return results;
}

export interface CourseSeed {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  priceText: string;
  image: string | null;
  url: string;
  features: string[];
  sort: number;
}

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isShoutedTitle(text: string): boolean {
  const letters = text.replace(/[^a-zA-Z]/g, "");
  return letters.length >= 4 && letters === letters.toUpperCase();
}

const SKIP_TITLES = new Set(["FOLLOW ME @ PROFITWITHYVETTE"]);

// Words that appear in nearly every course/image caption on this site and would
// otherwise dominate the keyword-overlap score without actually disambiguating
// which image belongs to which course.
const GENERIC_WORDS = new Set([
  "private",
  "practice",
  "practices",
  "therapist",
  "therapists",
  "boss",
  "clinician",
  "clinicians",
  "training",
  "resource",
  "resources",
  "for",
  "your",
  "with",
  "from",
  "course",
  "courses",
  "page",
]);

function scoreImageMatch(title: string, alt: string): number {
  const titleWords = new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w))
  );
  const altWords = alt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  let score = 0;
  for (const w of altWords) if (titleWords.has(w)) score++;
  return score;
}

/** Parses the training-library cards on /all-courses: H2 (ALL CAPS title) -> p subtitle -> p description -> a CTA. */
export function extractCoursesFromAllCourses(page: ContentPage): CourseSeed[] {
  const texts = page.texts;
  const courses: CourseSeed[] = [];

  const candidateImages = page.images.filter(
    (im) => im.alt && !/logo|header|footer/i.test(im.alt)
  );
  const usedImages = new Set<string>();

  let i = 0;
  while (i < texts.length) {
    const t = texts[i];
    if (t.tag === "h2" && isShoutedTitle(t.text) && !SKIP_TITLES.has(t.text.trim().toUpperCase())) {
      const title = t.text.trim();
      i++;
      const ps: string[] = [];
      let ctaLabel = "";
      while (i < texts.length && texts[i].tag !== "h2") {
        if (texts[i].tag === "a") {
          ctaLabel = texts[i].text.trim();
          i++;
          break;
        }
        if (texts[i].tag === "p") ps.push(texts[i].text.trim());
        i++;
      }
      const contentPs = ps.filter((p) => !/inside you.*get|you.?ll get:?$/i.test(p));

      let bestImage: ContentImage | undefined;
      let bestScore = 0;
      for (const im of candidateImages) {
        if (usedImages.has(im.src)) continue;
        const score = scoreImageMatch(title, im.alt);
        if (score > bestScore) {
          bestScore = score;
          bestImage = im;
        }
      }
      // No keyword overlap found — fall back to the next unused content image
      // rather than leaving the card without one.
      if (!bestImage) {
        bestImage = candidateImages.find((im) => !usedImages.has(im.src));
      }
      if (bestImage) usedImages.add(bestImage.src);

      const slug = toSlug(title);
      courses.push({
        slug,
        title,
        subtitle: contentPs[0] ?? "",
        description: contentPs.slice(1).join(" ") || contentPs[0] || "",
        priceText: "",
        image: bestImage?.src ?? null,
        // This site's own sales page, not a placeholder. `"#"` used to go here,
        // and a card carrying it rendered a link that resolved back to the page
        // the visitor was already reading — the whole catalogue looked dead.
        url: `/courses/${slug}`,
        features: ctaLabel ? [ctaLabel] : [],
        sort: courses.length,
      });
    } else {
      i++;
    }
  }

  return courses;
}

/** Parses the three consulting packages on /store: `a` link "<Title> $X,XXX.XX USD" followed by an h4 repeating the title. */
export function extractCoursesFromStore(page: ContentPage): CourseSeed[] {
  const texts = page.texts;
  const results: CourseSeed[] = [];
  const candidateImages = page.images.filter((im) => !/logo|footer|bg/i.test(im.alt) && im.alt !== "");
  // store.json images are largely alt="" — fall back to positional (skip index 0 logo).
  const fallbackImages = page.images.slice(1).filter((im) => im.alt !== "bg");

  let imgIdx = 0;
  for (let idx = 0; idx < texts.length; idx++) {
    const t = texts[idx];
    if (t.tag === "a") {
      const match = t.text.match(/^(.*?)\s\$([\d,]+\.\d{2})\s*USD$/);
      if (match) {
        const title = match[1].trim();
        const priceText = `$${match[2]} USD`;
        const image = candidateImages[imgIdx]?.src ?? fallbackImages[imgIdx]?.src ?? null;
        imgIdx++;
        const slug = toSlug(title);
        results.push({
          slug,
          title,
          subtitle: priceText,
          description: `1:1 consulting package — ${title}.`,
          priceText,
          image,
          url: `/courses/${slug}`,
          features: [],
          sort: results.length,
        });
      }
    }
  }
  return results;
}

export interface ResourceSeed {
  slug: string;
  title: string;
  description: string;
  image: string | null;
  ctaLabel: string;
  ctaUrl: string;
  kind: string;
  sort: number;
}

/** Best-effort parse of the free lead-magnet cards + masterclass on /resources. */
export function extractResources(page: ContentPage): ResourceSeed[] {
  const texts = page.texts;
  const images = page.images;
  const results: ResourceSeed[] = [];

  const findImage = (keywords: string[]): string | null => {
    const im = images.find((i) => keywords.some((k) => i.alt.toLowerCase().includes(k)));
    return im?.src ?? null;
  };

  // Free masterclass banner.
  const masterclassTitleIdx = texts.findIndex((t) => t.tag === "h2" && /4-step blueprint/i.test(t.text));
  if (masterclassTitleIdx !== -1) {
    const cta = texts.find((t, idx) => idx > masterclassTitleIdx && t.tag === "a" && /join the free training/i.test(t.text));
    results.push({
      slug: "free-masterclass",
      title: texts[masterclassTitleIdx].text.trim(),
      description:
        texts.find((t, idx) => idx > masterclassTitleIdx && t.tag === "p")?.text.trim() ??
        "A free training on building a profitable private practice.",
      image: findImage(["yvette", "strategist"]),
      ctaLabel: cta?.text.trim() ?? "Join the Free Training",
      ctaUrl: "#",
      kind: "masterclass",
      sort: 0,
    });
  }

  // Free guide / starter guide / checklist cards: h4 label -> p description -> a CTA.
  const cardDefs: { match: RegExp; slug: string; titleFallback: string; imageKeywords: string[] }[] = [
    { match: /^free guide$/i, slug: "free-guide-insurance-vs-superbills", titleFallback: "Free Guide", imageKeywords: ["insurance", "credentialing"] },
    { match: /^free starter guide$/i, slug: "free-starter-guide", titleFallback: "Free Starter Guide", imageKeywords: ["starter"] },
    { match: /^free checklist:?$/i, slug: "free-practice-planner-checklist", titleFallback: "Free Checklist", imageKeywords: ["planning", "checklist"] },
  ];

  for (const def of cardDefs) {
    const idx = texts.findIndex((t) => t.tag === "h4" && def.match.test(t.text.trim()));
    if (idx === -1) continue;
    const desc = texts[idx + 1]?.tag === "p" ? texts[idx + 1].text.trim() : "";
    const cta = texts[idx + 2]?.tag === "a" ? texts[idx + 2].text.trim() : "Download";
    results.push({
      slug: def.slug,
      title: desc ? `${def.titleFallback}: ${desc.replace(/\?$/, "")}`.slice(0, 120) : def.titleFallback,
      description: desc,
      image: findImage(def.imageKeywords),
      ctaLabel: cta,
      ctaUrl: "#",
      kind: "guide",
      sort: results.length,
    });
  }

  return results;
}
