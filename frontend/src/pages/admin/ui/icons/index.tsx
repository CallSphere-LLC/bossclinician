import { forwardRef, type ReactNode } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The admin's own glyphs — the handful of places where an icon is decoration
 * rather than a control (the dashboard figures, the brand mark, the assistant's
 * avatar, the automation mark). Drawn in Figma ("Boss Clinician — Admin Icons")
 * on lucide's 24px grid so they sit beside lucide's action icons, but finer: a
 * 1.5 stroke, round caps and joins, no fills. They inherit `currentColor`, so
 * they follow the console theme instead of carrying a colour of their own.
 *
 * Every glyph is typed as a `LucideIcon`, so it drops into any slot that takes
 * one (sidebar groups, tab lists, event-type maps) and accepts the same props:
 * `className` for size, `strokeWidth` where it has to match lucide's 2 in a
 * mixed row, and an `aria-label` when it is the only thing that names a
 * control. Without a label it is hidden from assistive technology.
 */
function createGlyph(displayName: string, glyph: ReactNode): LucideIcon {
  const slug = displayName.replace(/Glyph$/, "").toLowerCase();
  const Glyph = forwardRef<SVGSVGElement, Omit<LucideProps, "ref">>(
    (
      {
        size = 24,
        strokeWidth = 1.5,
        color = "currentColor",
        absoluteStrokeWidth,
        nonScalingStroke,
        className,
        children,
        ...rest
      },
      ref,
    ) => {
      const scaled =
        absoluteStrokeWidth || nonScalingStroke
          ? (Number(strokeWidth) * 24) / Number(size)
          : strokeWidth;
      return (
        <svg
          ref={ref}
          xmlns="http://www.w3.org/2000/svg"
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth={scaled}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden={rest["aria-label"] || rest["aria-labelledby"] ? undefined : true}
          className={cn("bc-glyph", `bc-glyph-${slug}`, className)}
          {...rest}
        >
          {glyph}
          {children}
        </svg>
      );
    },
  );
  Glyph.displayName = displayName;
  return Glyph;
}

/** An enquiry tray: the topbar inbox, the Enquiries figure, Latest enquiries. */
export const InboxGlyph = createGlyph(
  "InboxGlyph",
  <>
    <path d="M3 13.5 5.55 6.1A1.6 1.6 0 0 1 7.06 5h9.88a1.6 1.6 0 0 1 1.51 1.1L21 13.5" />
    <path d="M3 13.5v4.9A1.6 1.6 0 0 0 4.6 20h14.8a1.6 1.6 0 0 0 1.6-1.6v-4.9" />
    <path d="M3 13.5h4.6l1.4 2.5h6l1.4-2.5H21" />
  </>,
);

/** Two people, the second half-turned behind the first. */
export const MembersGlyph = createGlyph(
  "MembersGlyph",
  <>
    <circle cx="9" cy="8" r="3.25" />
    <path d="M3.25 19.5a5.75 5.75 0 0 1 11.5 0" />
    <path d="M15.25 4.9a3.25 3.25 0 0 1 0 6.2" />
    <path d="M17.4 14.1a5.75 5.75 0 0 1 3.35 5.4" />
  </>,
);

/** An open book. */
export const LessonsGlyph = createGlyph(
  "LessonsGlyph",
  <>
    <path d="M12 6.75C10.2 5.4 7.7 4.75 4 4.75v13c3.7 0 6.2.65 8 2 1.8-1.35 4.3-2 8-2v-13c-3.7 0-6.2.65-8 2Z" />
    <path d="M12 6.75v13" />
  </>,
);

/** A speech bubble with two lines of text in it. */
export const ConversationGlyph = createGlyph(
  "ConversationGlyph",
  <>
    <path d="M4.6 4.5h14.8A1.6 1.6 0 0 1 21 6.1v9.3a1.6 1.6 0 0 1-1.6 1.6H11l-4.5 3.5V17H4.6A1.6 1.6 0 0 1 3 15.4V6.1a1.6 1.6 0 0 1 1.6-1.6Z" />
    <path d="M7.5 9.25h9" />
    <path d="M7.5 12.25h5.5" />
  </>,
);

/** A portico: money on its way to the bank. */
export const BankGlyph = createGlyph(
  "BankGlyph",
  <>
    <path d="M3.5 9 12 4.25 20.5 9Z" />
    <path d="M6.5 11.5V16" />
    <path d="M12 11.5V16" />
    <path d="M17.5 11.5V16" />
    <path d="M4.5 17.25h15" />
    <path d="M3 20.25h18" />
  </>,
);

/** A payment card. */
export const CardGlyph = createGlyph(
  "CardGlyph",
  <>
    <rect x="2.75" y="5" width="18.5" height="14" rx="2" />
    <path d="M2.75 9.5h18.5" />
    <path d="M6.5 15h4" />
  </>,
);

/**
 * The site assistant: a voice mark in a ring. Deliberately not a robot and not
 * a sparkle — it answers typed and spoken chats on her behalf.
 */
export const AssistantGlyph = createGlyph(
  "AssistantGlyph",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 10.75v2.5" />
    <path d="M12 8.5v7" />
    <path d="M15.5 10v4" />
  </>,
);

/** A pen nib: drafting words (the blog editor's "draft it for me"). */
export const DraftGlyph = createGlyph(
  "DraftGlyph",
  <>
    <path d="M12 21 5.75 11.5 8.5 3.75h7l2.75 7.75Z" />
    <circle cx="12" cy="12.25" r="1.5" />
    <path d="M12 13.75v4.5" />
  </>,
);

/** A single person: a visitor to the site. */
export const VisitorGlyph = createGlyph(
  "VisitorGlyph",
  <>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5.5 19.75a6.5 6.5 0 0 1 13 0" />
  </>,
);

/** One event branching into what happens next: automations and webhooks. */
export const AutomationGlyph = createGlyph(
  "AutomationGlyph",
  <>
    <circle cx="5.25" cy="12" r="2.25" />
    <circle cx="18.75" cy="6" r="2.25" />
    <circle cx="18.75" cy="18" r="2.25" />
    <path d="M7.5 12H10c3 0 3-6 6.5-6" />
    <path d="M10 12c3 0 3 6 6.5 6" />
  </>,
);

/** A token with a cut stone: community points. */
export const PointsGlyph = createGlyph(
  "PointsGlyph",
  <>
    <circle cx="12" cy="12" r="8.75" />
    <path d="M12 7.5 15.25 12 12 16.5 8.75 12Z" />
  </>,
);

/**
 * The sidebar's brand mark: a serif B inside a fine gold rule. It replaced a
 * gold-foil tile with a glow under it; a mark this small reads as more
 * expensive the less it does.
 */
export function Monogram({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-lg border border-gold/55 font-display text-[1.1rem] leading-none text-gold",
        className,
      )}
    >
      B
    </span>
  );
}
