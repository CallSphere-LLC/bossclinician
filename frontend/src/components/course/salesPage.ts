/**
 * A course's long-form sales page: the data shape stored in `courses.sales_page`
 * (migration 128), the parser that admits it, and the buy-button resolver.
 *
 * Kept free of React so all three are unit-testable in the node test runner.
 * CourseSalesPage.tsx renders what this file produces.
 *
 * Copy is the owner's wording, stored as data rather than JSX so another course
 * can be given the same layout by writing one JSONB value. The one thing the
 * data never holds is a buy button: those come from the course's published
 * offers and their pricing options, so a price on a button is the price the
 * checkout charges.
 */
import { money, priceLabel, type CourseOffer } from "@/components/course/CoursePriceLabel";

/* ── Stored shape ─────────────────────────────────────────────────────── */

export interface SalesImage {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

/**
 * One titled band. Its parts render in a fixed order — intro, list,
 * paragraphs, notes — which is the order every section of the source
 * documents uses. Strings may carry the inline markup `parseInline` reads.
 */
export interface SalesSection {
  id?: string;
  title: string;
  intro?: string;
  list?: string[];
  paragraphs?: string[];
  /** Fine print under the body, set smaller. */
  notes?: string[];
  /** A photograph beside the text (an instructor portrait). */
  image?: SalesImage;
  /** A small mark beside the text at its own size (an accreditation seal). */
  badge?: SalesImage;
}

export interface SalesPageData {
  version: number;
  hero: {
    title: string;
    /** Second line of the headline, set in foil italic. */
    titleAccent?: string;
    subtitle?: string;
    paragraphs?: string[];
    /** Short facts printed as a row ("1.5 CE Hours"); numbers set as numbers. */
    highlights?: string[];
    image?: SalesImage;
  };
  /** Screenshots of attendee messages, shown as they are. */
  proof?: { label: string; images: SalesImage[] };
  sections: SalesSection[];
  /** The closing call to action: the buy buttons again, over a photograph. */
  closing?: { image?: SalesImage };
  footer?: string;
}

/* ── Parsing: admit only what the renderer can draw ───────────────────── */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v : undefined;

const strList = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const items = v.filter((s): s is string => typeof s === "string" && s.trim() !== "");
  return items.length > 0 ? items : undefined;
};

/** Site-relative paths and https only — this is admin-writable data. */
const image = (v: unknown): SalesImage | undefined => {
  if (!isRecord(v)) return undefined;
  const src = str(v.src);
  if (!src || !(/^\/[^/]/.test(src) || src.startsWith("https://"))) return undefined;
  const dim = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined);
  return { src, alt: typeof v.alt === "string" ? v.alt : "", width: dim(v.width), height: dim(v.height) };
};

/**
 * The stored page, or null when there is none or it cannot be drawn — in which
 * case CourseDetail falls back to the catalogue layout rather than a broken
 * page. Malformed parts are dropped one by one, not the whole page.
 */
export function parseSalesPage(raw: unknown): SalesPageData | null {
  if (!isRecord(raw) || !isRecord(raw.hero)) return null;
  const title = str(raw.hero.title);
  if (!title) return null;

  const sections: SalesSection[] = Array.isArray(raw.sections)
    ? raw.sections.flatMap((s): SalesSection[] => {
        if (!isRecord(s)) return [];
        const sectionTitle = str(s.title);
        if (!sectionTitle) return [];
        return [
          {
            id: typeof s.id === "string" && /^[a-z0-9-]+$/.test(s.id) ? s.id : undefined,
            title: sectionTitle,
            intro: str(s.intro),
            list: strList(s.list),
            paragraphs: strList(s.paragraphs),
            notes: strList(s.notes),
            image: image(s.image),
            badge: image(s.badge),
          },
        ];
      })
    : [];

  const proofImages = isRecord(raw.proof) && Array.isArray(raw.proof.images)
    ? raw.proof.images.map(image).filter((i): i is SalesImage => Boolean(i))
    : [];

  return {
    version: typeof raw.version === "number" ? raw.version : 1,
    hero: {
      title,
      titleAccent: str(raw.hero.titleAccent),
      subtitle: str(raw.hero.subtitle),
      paragraphs: strList(raw.hero.paragraphs),
      highlights: strList(raw.hero.highlights),
      image: image(raw.hero.image),
    },
    proof:
      proofImages.length > 0
        ? { label: (isRecord(raw.proof) && str(raw.proof.label)) || "From past attendees", images: proofImages }
        : undefined,
    sections,
    closing: isRecord(raw.closing) ? { image: image(raw.closing.image) } : undefined,
    footer: str(raw.footer),
  };
}

/* ── Inline markup ────────────────────────────────────────────────────── */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "link"; text: string; href: string }
  | { kind: "email"; address: string };

const EMAIL = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}";

/**
 * `**bold**`, `[label](/path)` and bare email addresses — the three things the
 * owner's documents use — and nothing else. Everything is returned as data for
 * React to render as text, so a stray `<` in the copy is a character, never
 * markup.
 */
export function parseInline(src: string): Inline[] {
  const token = new RegExp(`\\*\\*(.+?)\\*\\*|\\[([^\\]]+)\\]\\(([^)\\s]+)\\)|(${EMAIL})`, "g");
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(token)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: src.slice(last, at) });
    if (m[1] !== undefined) out.push({ kind: "strong", children: parseInline(m[1]) });
    else if (m[2] !== undefined) out.push({ kind: "link", text: m[2], href: m[3] });
    else out.push({ kind: "email", address: m[4] });
    last = at + m[0].length;
  }
  if (last < src.length) out.push({ kind: "text", text: src.slice(last) });
  return out;
}

/* ── Buy buttons ──────────────────────────────────────────────────────── */

/** An offer's extra way to pay, as GET /courses/:slug sends it. */
export interface SalesPricingOption {
  id: number;
  label: string;
  recommended: boolean;
  pricingType: CourseOffer["pricingType"];
  amountCents: number;
  currency: string;
  interval: string | null;
  intervalCount: number;
  installmentCount: number | null;
}

export type SalesOffer = CourseOffer & { pricingOptions?: SalesPricingOption[] };

export interface SalesButton {
  key: string;
  label: string;
  /** `/checkout/<offer>`, or `/checkout/<offer>?option=<id>` for an extra price. */
  to: string;
  primary: boolean;
}

const sameCurrency = (a: string, b: string) => (a || "usd").toLowerCase() === (b || "usd").toLowerCase();

/**
 * One button per way to pay, across the course's purchasable offers.
 *
 * An offer's own price is a way to pay too (checkout lists it as option 0), so
 * it gets a button — unless one of its pricing options charges exactly the
 * same, which is how an offer is set up when its base price is restated as a
 * labelled option ("Training + CE Credit — $77"); two buttons for one price
 * would only make the reader wonder what the difference is.
 *
 * A label that does not already state its price gets it appended from the
 * charged amount, so no button can be a price-free promise.
 */
export function salesButtons(offers: readonly SalesOffer[]): SalesButton[] {
  const buttons: (SalesButton & { recommended: boolean })[] = [];

  for (const offer of offers) {
    if (!offer.available) continue;
    const base = `/checkout/${encodeURIComponent(offer.slug)}`;
    const options = offer.pricingOptions ?? [];

    const baseDuplicated = options.some(
      (o) =>
        o.amountCents === offer.amountCents &&
        o.pricingType === offer.pricingType &&
        sameCurrency(o.currency, offer.currency),
    );
    if (!baseDuplicated) {
      buttons.push({
        key: offer.slug,
        label: offer.pricingType === "free" ? "Get it free" : `Register — ${priceLabel(offer)}`,
        to: base,
        primary: false,
        recommended: false,
      });
    }

    for (const option of options) {
      const price = priceLabel({
        ...offer,
        pricingType: option.pricingType,
        amountCents: option.amountCents,
        currency: option.currency,
        interval: option.interval,
        intervalCount: option.intervalCount,
        installmentCount: option.installmentCount,
      });
      const label = option.label.trim();
      const plain = money(option.amountCents, option.currency);
      buttons.push({
        key: `${offer.slug}:${option.id}`,
        label: !label
          ? `Register — ${price}`
          : label.includes(price) || label.includes(plain)
            ? label
            : `${label} — ${price}`,
        to: `${base}?option=${option.id}`,
        primary: false,
        recommended: option.recommended,
      });
    }
  }

  const primary = Math.max(0, buttons.findIndex((b) => b.recommended));
  return buttons.map(({ recommended: _recommended, ...b }, i) => ({ ...b, primary: i === primary }));
}
