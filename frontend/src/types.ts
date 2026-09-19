export interface BlogCard {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  /** Nullable in the API: `blog_posts.cover_image` has no NOT NULL. */
  coverImage: string | null;
  tags: string[];
  author: string;
  readMinutes: number;
  /** Nullable in the API: a post can be published with no date set. */
  publishedAt: string | null;
  /** Absent from the bundled fallback copy, which has no edit history. */
  updatedAt?: string;
}

export interface BlogPost extends BlogCard {
  bodyMd: string;
}

export interface Course {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  priceText: string;
  /**
   * Stripe: set stripePriceId or priceCents to make the course purchasable.
   * Optional because the bundled fallback content predates checkout — only
   * DB-backed courses carry these.
   */
  priceCents?: number | null;
  currency?: string;
  stripePriceId?: string | null;
  image: string;
  url: string;
  features: string[];
  sort: number;
  published: boolean;
}

/** A course is buyable online once Stripe has something to charge against. */
export function isPurchasable(course: Course): boolean {
  return Boolean(course.stripePriceId) || (course.priceCents ?? 0) > 0;
}

export interface CheckoutOrder {
  courseSlug: string;
  courseTitle: string;
  email: string;
  amountCents: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "expired";
}

export interface Testimonial {
  id: string;
  name: string;
  credential: string;
  quote: string;
  /** Practice or business name shown under the attribution. */
  practice?: string;
  /**
   * Square headshot used for the 56px avatar. Optional on purpose — when it is
   * missing the card falls back to an initial-letter placeholder tinted with
   * the card's accent colour, so a testimonial without a photo still looks
   * deliberate. `image` below is legacy scraped artwork, not the avatar.
   */
  photo?: string;
  image: string;
  sort: number;
  published: boolean;
}

export interface Resource {
  id: string;
  slug: string;
  title: string;
  description: string;
  image: string;
  ctaLabel: string;
  ctaUrl: string;
  kind: string;
  sort: number;
  published: boolean;
}

export interface PageSection {
  [key: string]: unknown;
}

export interface Page {
  slug: string;
  title: string;
  description: string;
  sections: PageSection;
}

export interface LeadPayload {
  name: string;
  email: string;
  phone?: string;
  message?: string;
  /** Mirrors the `leadSchema` enum in backend/src/validation/schemas.ts. */
  source: "apply" | "contact" | "work-with-me" | "income-calculator";
  meta?: Record<string, unknown>;
  /** Honeypot pair from `useHoneypot`; a person leaves `company` empty. */
  company?: string;
  elapsedMs?: number;
}

export interface PublicFormField {
  key: string;
  label: string;
  /**
   * The builder offers text | email | textarea | select | checkbox, but the
   * column is free-form JSONB — anything else renders as a plain text input
   * rather than disappearing from the page.
   */
  type: string;
  required?: boolean;
  /** Only meaningful for `select`. */
  options?: string[];
}

/**
 * A published form as the public endpoint serves it — the admin-only columns
 * (createLead, published, views) are deliberately absent from the payload.
 */
export interface PublicForm {
  id: number;
  slug: string;
  name: string;
  description: string;
  fields: PublicFormField[];
  submitLabel: string;
  successMessage: string;
}

/**
 * One step of a published funnel, as the public endpoint serves it. The
 * counters (views, conversions) stay admin-only — the visitor's page bumps
 * them, it never reads them.
 */
export interface PublicFunnelStep {
  id: number;
  name: string;
  /** May be empty: the builder defaults it and does not force one. */
  slug: string;
  /** landing | opt_in | offer | upsell | thank_you, free-form in the column. */
  stepType: string;
  headline: string;
  bodyMd: string;
  ctaLabel: string;
  ctaUrl: string;
  sort: number;
}

export interface PublicFunnel {
  slug: string;
  name: string;
  description: string;
  kind: string;
  steps: PublicFunnelStep[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  sessionId: string;
  reply: string;
  suggestions?: string[];
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface AdminStats {
  leads: number;
  subscribers: number;
  posts: number;
  chats: number;
  [key: string]: number;
}

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone?: string;
  message?: string;
  source: string;
  status: string;
  createdAt: string;
  /**
   * Free-form JSONB. `{}` for the plain contact/apply forms; the calculator
   * scenario for `income-calculator` leads; the raw submission body for the
   * `form:<slug>` leads dynamic forms create.
   */
  meta?: Record<string, unknown>;
}

export interface Subscriber {
  id: string;
  email: string;
  source: string;
  createdAt: string;
}
