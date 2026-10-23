import type { OfferInput } from "@/lib/adminCommerceApi";
import { formatCurrency } from "@/lib/format";
import type { CourseCustomer, CourseOffer } from "./courseHubApi";

/**
 * The tabs across the top of every course, in Kajabi's order. Outline is the
 * builder that was always here; the tab is kept in the address (`?tab=offers`)
 * so a link from the offer editor, a refresh, or the back button lands on the
 * same tab rather than on the outline every time.
 */
export const COURSE_TABS = [
  { id: "outline", label: "Outline" },
  { id: "offers", label: "Offers" },
  { id: "customers", label: "Customers" },
  { id: "settings", label: "Settings" },
] as const;

export type CourseTab = (typeof COURSE_TABS)[number]["id"];

/** `?tab=` → a tab that exists; anything else (or nothing) is the outline. */
export function courseTabOf(param: string | null | undefined): CourseTab {
  const wanted = (param ?? "").trim().toLowerCase();
  return COURSE_TABS.find((tab) => tab.id === wanted)?.id ?? "outline";
}

/** The course builder, opened on a tab. */
export function courseTabPath(courseId: number | string, tab: CourseTab): string {
  const base = `/admin/courses/${encodeURIComponent(String(courseId))}/curriculum`;
  return tab === "outline" ? base : `${base}?tab=${tab}`;
}

/** "$497", "$49 / month", "3 × $1,250", "Free" — an offer's price as she'd say it. */
export function offerPriceLabel(
  offer: Pick<CourseOffer, "pricingType" | "amountCents" | "currency" | "interval" | "intervalCount" | "installmentCount">,
): string {
  const money = formatCurrency(offer.amountCents, offer.currency || "usd").replace(/\.00$/, "");
  const every =
    offer.interval === null
      ? ""
      : offer.intervalCount > 1
        ? ` / ${offer.intervalCount} ${offer.interval}s`
        : ` / ${offer.interval}`;
  switch (offer.pricingType) {
    case "free":
      return "Free";
    case "pwyw":
      return offer.amountCents > 0 ? `Pay what you want, from ${money}` : "Pay what you want";
    case "subscription":
      return `${money}${every}`;
    case "payment_plan":
      return `${offer.installmentCount ?? 2} × ${money}${every}`;
    default:
      return money;
  }
}

/** Whole-number percent of the course's published lessons a student has finished. */
export function progressPercent(completed: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const done = Math.max(0, Math.min(completed, total));
  return Math.round((done / total) * 100);
}

/** How somebody came to have the course, in her words rather than the column's. */
export function grantSourceLabel(customer: Pick<CourseCustomer, "source" | "offerTitle">): string {
  const via = customer.offerTitle ? ` · ${customer.offerTitle}` : "";
  switch (customer.source) {
    case "purchase":
      return `Bought it${via}`;
    case "manual":
      return `Given by you${via}`;
    case "import":
      return "Moved over from Kajabi";
    case "plan":
      return `Membership plan${via}`;
    case "bundle":
      return `In a bundle${via}`;
    case "automation":
      return `Automation${via}`;
    case "affiliate":
      return `Partner sale${via}`;
    default:
      return customer.source;
  }
}

/** Customers who can open the course now, then everybody whose access ended. */
export function splitCustomers(customers: CourseCustomer[]): {
  current: CourseCustomer[];
  former: CourseCustomer[];
} {
  return {
    current: customers.filter((customer) => customer.status === "active"),
    former: customers.filter((customer) => customer.status !== "active"),
  };
}

/** Search box: name or email, ignoring case and spacing. */
export function matchesCustomer(customer: Pick<CourseCustomer, "name" | "email">, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return customer.name.toLowerCase().includes(q) || customer.email.toLowerCase().includes(q);
}

/**
 * The offer "Create an offer for this course" saves, as a draft. Everything but
 * the name and the price is the offer editor's own default, so the offer she
 * finishes there is exactly the one she would have started there.
 *
 * A one-time offer must cost more than nothing (the server refuses $0 and
 * says to choose Free), so a blank price is Free rather than a refused save.
 */
export function newCourseOfferInput(
  title: string,
  slug: string,
  priceCents: number | null,
  currency = "usd",
): OfferInput & { currency: string } {
  const paid = priceCents !== null && priceCents > 0;
  return {
    title,
    internalTitle: "",
    slug,
    status: "draft",
    description: "",
    checkoutHeadline: "",
    thumbnailUrl: "",
    currency,
    pricingType: paid ? "one_time" : "free",
    amountCents: paid ? priceCents : 0,
    depositCents: 0,
    minAmountCents: 0,
    interval: null,
    intervalCount: 1,
    installmentCount: null,
    trialDays: 0,
    collectTax: false,
    collectAddress: false,
    collectPhone: false,
    customFields: [],
    termsUrl: "",
    requireTerms: false,
    redirectUrl: "",
    thankYouPageId: null,
    accessExpiresAfterDays: null,
    sendWelcomeEmail: true,
    allowGifting: true,
    showInCart: true,
    welcomeNextSteps: "",
  };
}

/** "497" / "$1,250.50" → cents; blank → null (Free); nonsense → undefined. */
export function priceCentsFromInput(raw: string): number | null | undefined {
  const cleaned = raw.replace(/[^0-9.]/g, "").trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 100);
}

/** The draft lesson a live session's recording goes into. */
export function replayLessonTitle(sessionTitle: string): string {
  const title = sessionTitle.trim() || "Live session";
  return /\breplay\b/i.test(title) ? title : `${title} (replay)`;
}

/** The section replay lessons go into when she doesn't pick one. */
export const LIVE_SECTION_TITLE = "Live session replays";
