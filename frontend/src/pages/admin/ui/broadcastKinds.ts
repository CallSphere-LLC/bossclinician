import {
  CalendarDays,
  Mail,
  Megaphone,
  Newspaper,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

/**
 * The kinds of Broadcast — Final Email Structure.
 *
 * "Do not create Newsletter as a separate sidebar page or separate email
 * system. A newsletter is a type of Broadcast." So this is a *label on one
 * system*, not a fork in it: every kind writes the same row, goes through the
 * same editor and the same send path. What the kind changes is what the
 * editor suggests — a starting subject and a first line — so the owner is not
 * staring at an empty box.
 *
 * `suggestion` is a starting point she overwrites, never something sent as-is.
 */

export type BroadcastKind =
  | "newsletter"
  | "promotion"
  | "event_invitation"
  | "announcement"
  | "program_update"
  | "general";

export interface BroadcastKindSpec {
  kind: BroadcastKind;
  label: string;
  /** What this kind is for, in the owner's words. */
  description: string;
  Icon: LucideIcon;
  /** Prefilled into a new broadcast's subject line. */
  suggestedSubject: string;
  /** Prefilled into the body, as a scaffold to replace. */
  suggestedBody: string;
}

export const BROADCAST_KINDS: BroadcastKindSpec[] = [
  {
    kind: "newsletter",
    label: "Newsletter",
    description: "Regular news, tips, resources, and business updates.",
    Icon: Newspaper,
    suggestedSubject: "",
    suggestedBody:
      "Hello,\n\nHere's what's new this month.\n\n## What I've been thinking about\n\n\n\n## Something useful\n\n\n\n## What's coming up\n\n\n\nSpeak soon,\n",
  },
  {
    kind: "promotion",
    label: "Promotion",
    description: "Promote a course, coaching program, offer, launch, or other service.",
    Icon: TrendingUp,
    suggestedSubject: "",
    suggestedBody:
      "Hello,\n\n\n\n**What you get**\n\n-\n-\n-\n\n**Who it's for**\n\n\n\n[Take a look](#)\n",
  },
  {
    kind: "event_invitation",
    label: "Event Invitation",
    description: "Invite subscribers, leads, or customers to an event.",
    Icon: CalendarDays,
    suggestedSubject: "",
    suggestedBody:
      "Hello,\n\nYou're invited.\n\n**When:**\n\n**Where:**\n\n**What we'll cover:**\n\n-\n-\n\n[Save your place](#)\n",
  },
  {
    kind: "announcement",
    label: "Announcement",
    description: "Share important news or updates.",
    Icon: Megaphone,
    suggestedSubject: "",
    suggestedBody: "Hello,\n\nI wanted to let you know about something.\n\n\n\nThank you,\n",
  },
  {
    kind: "program_update",
    label: "Program / Course Update",
    description: "Communicate changes or news about an offering.",
    Icon: Sparkles,
    suggestedSubject: "",
    suggestedBody:
      "Hello,\n\nThere's an update to share about your program.\n\n**What's changed**\n\n\n\n**What you need to do**\n\n\n\nAny questions, just reply.\n",
  },
  {
    kind: "general",
    label: "General Email",
    description: "Send an email that does not fit another type.",
    Icon: Mail,
    suggestedSubject: "",
    suggestedBody: "",
  },
];

const BY_KIND = new Map(BROADCAST_KINDS.map((spec) => [spec.kind, spec]));

/** Falls back to General so a row written before kinds existed still renders. */
export function broadcastKind(kind: string | null | undefined): BroadcastKindSpec {
  return BY_KIND.get((kind ?? "general") as BroadcastKind) ?? BY_KIND.get("general")!;
}
