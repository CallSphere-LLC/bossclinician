import { Link } from "react-router";
import { MemberAvatar } from "@/components/member/MemberShell";
import { cn } from "@/lib/cn";

/**
 * A person, everywhere they appear: bylines, comments, the directory, the
 * leaderboard.
 *
 * `MemberAvatar` wants a name and an email because that is what it falls back
 * to for initials. There is no email to give it here and there never will be —
 * the community API does not send one — so it gets an empty string and takes
 * the initials from the display name, which is the only thing other members are
 * entitled to see anyway.
 */

interface MemberChipProps {
  name: string;
  avatarUrl?: string;
  headline?: string;
  /** Turns the chip into a link to the profile. Host posts have no profile. */
  to?: string;
  /** Trailing badge emoji, role pill, or a timestamp. */
  meta?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const AVATAR_SIZE = {
  sm: "size-8",
  md: "size-9",
  lg: "size-12",
} as const;

const NAME_SIZE = {
  sm: "text-[0.82rem]",
  md: "text-sm",
  lg: "text-base",
} as const;

export function MemberChip({
  name,
  avatarUrl,
  headline,
  to,
  meta,
  size = "md",
  className,
}: MemberChipProps) {
  const body = (
    <>
      <MemberAvatar
        src={avatarUrl}
        name={name}
        email=""
        className={cn(AVATAR_SIZE[size], "shrink-0")}
      />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate font-semibold text-white", NAME_SIZE[size])}>
          {name || "Member"}
        </span>
        {headline && <span className="block truncate text-xs text-orchid-dim">{headline}</span>}
      </span>
      {meta && <span className="shrink-0 text-xs text-orchid-faint">{meta}</span>}
    </>
  );

  if (!to) {
    return <span className={cn("flex items-center gap-3", className)}>{body}</span>;
  }

  return (
    <Link
      to={to}
      className={cn(
        "flex min-h-[2.75rem] items-center gap-3 rounded-xl -mx-2 px-2",
        "transition-colors duration-300 hover:bg-white/[0.04]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
        className,
      )}
    >
      {body}
    </Link>
  );
}
