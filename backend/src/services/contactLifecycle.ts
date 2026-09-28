/**
 * The contact Lifecycle feed, described in Kajabi's words (QA sheet row 25).
 *
 * Kajabi's "Filter by event type" menu has a fixed list of types, and the
 * tester found the rebuild offering only the two its feed happened to contain.
 * Every moment the rebuild records — a `contact_activity` row, or one of the
 * rows the detail route reads straight from email, automation, tag and grant
 * tables — is given one of Kajabi's types here, and a headline worded the way
 * Kajabi words that type.
 *
 * Pure, so the mapping is tested without a database.
 */

/** Kajabi's menu, in Kajabi's order. */
export const LIFECYCLE_EVENT_TYPES = [
  "Form Submission",
  "Email Delivery",
  "Email Sequence Subscription",
  "Offer Purchase",
  "Offer Grant",
  "Event Registration",
  "Assessment Result",
  // Kajabi's AI agents. The rebuild records no agent chats against a contact
  // yet, so nothing maps here; it is listed so the menu matches Kajabi's.
  "Expert Agent Chat",
  "Contact Created",
  "Tag Added",
  "Automation Enrollment",
] as const;

export type LifecycleEventType = (typeof LIFECYCLE_EVENT_TYPES)[number];

/**
 * Which Kajabi type each kind of moment belongs to.
 *
 * Kinds with no Kajabi counterpart — notes, merges, email-preference changes,
 * an administrator confirming an address — stay in the feed under "All types"
 * and belong to no type, rather than being filed somewhere they don't fit.
 */
const TYPE_BY_KIND: Record<string, LifecycleEventType> = {
  "lead.created": "Form Submission",
  "form.submitted": "Form Submission",
  subscribed: "Form Submission",
  "email.delivered": "Email Delivery",
  "email.sent": "Email Delivery",
  "email.opened": "Email Delivery",
  "email.clicked": "Email Delivery",
  sequence_started: "Email Sequence Subscription",
  sequence_completed: "Email Sequence Subscription",
  purchase: "Offer Purchase",
  offer_granted: "Offer Grant",
  "offer.granted": "Offer Grant",
  "event.registered": "Event Registration",
  "event.attended": "Event Registration",
  "assessment.completed": "Assessment Result",
  "agent.chat": "Expert Agent Chat",
  imported: "Contact Created",
  created: "Contact Created",
  "account.created": "Contact Created",
  "tag.added": "Tag Added",
  "automation.enrolled": "Automation Enrollment",
};

export function lifecycleEventType(kind: string): LifecycleEventType | null {
  return Object.prototype.hasOwnProperty.call(TYPE_BY_KIND, kind) ? TYPE_BY_KIND[kind] : null;
}

export interface LifecycleRow {
  kind: string;
  title: string;
  body: string;
  meta: Record<string, unknown> | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function withoutPrefix(title: string, prefix: RegExp): string {
  return title.replace(prefix, "").trim();
}

/**
 * The line Kajabi would print for this moment.
 *
 * The stored title is kept as the fallback: it was written when the moment
 * happened and reads correctly even after the thing it names is renamed.
 */
export function lifecycleHeadline(row: LifecycleRow): string {
  const meta = row.meta ?? {};
  switch (row.kind) {
    case "imported":
      // Dated at the day Kajabi added them, not the day the file was imported.
      return "Contact created";
    case "created":
      return "Contact created via Admin";
    case "account.created":
      return row.title || "Account created";
    case "lead.created": {
      const source = text(meta.source);
      return source ? `Opted Into ${source.charAt(0).toUpperCase()}${source.slice(1)}` : "Contact created via Form Submission";
    }
    case "form.submitted":
      return `Opted Into ${withoutPrefix(row.title, /^Filled in\s+/i) || "a form"}`;
    case "subscribed":
      return "Opted Into your mailing list";
    case "email.delivered": {
      const source = text(meta.sourceType);
      if (source === "broadcast") return `Was broadcasted by ${text(meta.campaign) || row.title}`;
      if (source === "sequence") return `Was sent “${text(meta.subject) || row.title}” from ${text(meta.sequence) || "a sequence"}`;
      return `Was sent “${text(meta.subject) || row.title}”`;
    }
    case "sequence_started":
      return `Subscribed to ${withoutPrefix(row.title, /^Started the\s+/i).replace(/\s+sequence$/i, "")}`;
    case "sequence_completed":
      return `Completed ${withoutPrefix(row.title, /^Finished the\s+/i).replace(/\s+sequence$/i, "")}`;
    case "purchase":
      return `Purchased ${withoutPrefix(row.title, /^Bought\s+/i) || "an offer"}`;
    case "offer_granted":
    case "offer.granted":
      return row.title && row.title !== "Offer access granted" ? `Granted ${row.title}` : "Granted an offer";
    case "tag.added":
      return `Tag added: ${row.title}`;
    case "automation.enrolled":
      return `Enrolled in ${row.title}`;
    default:
      return row.title;
  }
}
