/**
 * What a course offer costs, in one place.
 *
 * Three surfaces now quote the same offer — the generic course page, and the
 * two long-form sales pages built for individual products — and a price that
 * reads "$247" in the hero and "$17" in the buy panel is the kind of mismatch
 * a buyer files a dispute over. So the shapes the API sends, the formatter and
 * the sentence a buyer reads all live here, and every surface prints the
 * number the database actually charges rather than one typed into JSX.
 */
import type { Course } from "@/types";

/** One lesson in the published outline. Titles and lengths only — no bodies. */
export interface CurriculumLesson {
  id: number;
  title: string;
  slug: string;
  durationMinutes: number;
  contentType: string;
  preview: boolean;
}

export interface CurriculumModule {
  id: number;
  title: string;
  summary: string;
  lessons: CurriculumLesson[];
}

export interface CourseOffer {
  available: boolean;
  unavailableReason: string;
  slug: string;
  title: string;
  pricingType: "one_time" | "subscription" | "payment_plan" | "free" | "pwyw";
  amountCents: number;
  currency: string;
  interval: string | null;
  intervalCount: number;
  installmentCount: number | null;
  checkoutHeadline: string;
}

/** What `GET /api/courses/:slug` answers with, and what the SSR payload seeds. */
export interface CourseDetailResponse extends Course {
  modules: CurriculumModule[];
  offers: CourseOffer[];
  owned: boolean;
}

export const money = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

/**
 * How an offer's price reads to a buyer.
 *
 * A payment plan states the instalment AND the total. Someone who thinks they
 * are paying $1,250 and then watches $3,750 leave their account over three
 * months raises a chargeback, and they are right to.
 */
export function priceLabel(offer: CourseOffer): string {
  switch (offer.pricingType) {
    case "free":
      return "Free";
    case "pwyw":
      return "Pay what you can";
    case "subscription": {
      const every =
        offer.intervalCount > 1
          ? `every ${offer.intervalCount} ${offer.interval}s`
          : `a ${offer.interval}`;
      return `${money(offer.amountCents, offer.currency)} ${every}`;
    }
    case "payment_plan": {
      const count = offer.installmentCount ?? 1;
      const total = money(offer.amountCents * count, offer.currency);
      return `${count} payments of ${money(offer.amountCents, offer.currency)} — ${total} in total`;
    }
    default:
      return money(offer.amountCents, offer.currency);
  }
}

/**
 * The headline price, set large.
 *
 * A sales page prints the figure several times — hero, investment band, final
 * call — and each one is the same string from the same offer.
 */
export function CoursePrice({ offer, className }: { offer: CourseOffer; className?: string }) {
  return <span className={className}>{priceLabel(offer)}</span>;
}
