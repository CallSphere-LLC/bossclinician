import type {
  AdminFeedbackRow,
  AdminOfferCard,
  OfferCardStatus,
  TaskKey,
  TaskStatus,
  TestimonialConsent,
} from "@/lib/retreatsApi";

/**
 * Pure rules behind the organizer screens, kept apart from the JSX so they can
 * be tested without a DOM. The server enforces each of them again; these only
 * stop the owner pressing a button that would be refused.
 */

export const TASK_LABELS: Record<TaskKey, string> = {
  agreement: "Agreement",
  guest_profile: "Guest Profile",
  flight_preferences: "Flight Preferences",
  travel_insurance: "Travel Insurance",
  flight_details: "Flight Details",
  passport: "Passport & Preparation",
  payments: "Payments",
  group_call: "Group Call",
};

export const TASK_ORDER: TaskKey[] = [
  "agreement",
  "guest_profile",
  "flight_preferences",
  "travel_insurance",
  "flight_details",
  "passport",
  "payments",
  "group_call",
];

export const STATUS_TONE: Record<TaskStatus, "neutral" | "blue" | "gold" | "green" | "red"> = {
  not_started: "neutral",
  in_progress: "blue",
  submitted: "gold",
  verified: "green",
  needs_attention: "red",
};

/** The agreement follows the signed contract record only — never a manual review. */
export function isReviewable(task: TaskKey): boolean {
  return task !== "agreement";
}

export const CARD_STATUS_LABEL: Record<OfferCardStatus, string> = {
  draft: "Draft",
  interest_list: "Interest List",
  registration_open: "Registration Open",
  sold_out: "Sold Out",
};

/** A link a card may send a guest to: https, or a path on this site. */
export function isSafeCardUrl(url: string): boolean {
  const value = url.trim();
  if (value === "") return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  return /^https:\/\/[^\s]+$/i.test(value);
}

/** Why a "Join Us Again" card cannot be saved yet, or null. */
export function cardProblem(card: Pick<AdminOfferCard, "title" | "status" | "ctaUrl" | "displayFrom" | "displayUntil">): string | null {
  if (card.title.trim() === "") return "Give the card a title.";
  if (card.status === "registration_open" && !isSafeCardUrl(card.ctaUrl ?? "")) {
    return "Registration Open needs a verified booking link (https:// or a page on this site).";
  }
  if ((card.ctaUrl ?? "").trim() !== "" && !isSafeCardUrl(card.ctaUrl)) {
    return "The button link must start with https:// or / (a page on this site).";
  }
  if (card.displayFrom && card.displayUntil && new Date(card.displayFrom) > new Date(card.displayUntil)) {
    return "The display period ends before it starts.";
  }
  return null;
}

/** Approve for publication only with a submitted reflection, a testimonial and an explicit yes. */
export function canApproveForPublication(row: Pick<AdminFeedbackRow, "state" | "testimonialConsent" | "testimonialText">): boolean {
  return row.state === "submitted" && row.testimonialConsent !== "no" && row.testimonialText.trim() !== "";
}

const CONSENT_LABEL: Record<TestimonialConsent, string> = {
  no: "No public use",
  first_name: "Yes — first name only",
  first_name_role: "Yes — first name + professional role",
  full_name: "Yes — full name",
};

export function consentLabel(consent: TestimonialConsent): string {
  return CONSENT_LABEL[consent];
}

/** How the quote may be attributed, exactly as consented. */
export function consentedAttribution(name: string, consent: TestimonialConsent, role: string): string | null {
  const first = name.trim().split(/\s+/)[0] ?? "";
  switch (consent) {
    case "no":
      return null;
    case "first_name":
      return first;
    case "first_name_role":
      return role.trim() ? `${first}, ${role.trim()}` : first;
    case "full_name":
      return name.trim();
  }
}

/** "<input type=datetime-local>" value ↔ ISO instant, in the browser's zone. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
