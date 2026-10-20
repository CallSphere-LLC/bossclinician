import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * The member's avatar, and the initials it falls back to.
 *
 * Its own module (re-exported from MemberShell, where it used to live) so the
 * header's notification bell can draw avatars without importing the shell that
 * renders it.
 */

/** Two letters at most: three initials in a 36px circle stop being legible. */
export function memberInitials(name: string, email: string): string {
  const fromName = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  return (fromName || email.slice(0, 1) || "?").toUpperCase();
}

interface MemberAvatarProps {
  src?: string;
  name: string;
  email: string;
  className?: string;
}

/**
 * Falls back to foiled initials rather than a grey silhouette — most members
 * never upload a photo, so the placeholder is on screen far more often than
 * any real avatar is. `onError` covers an avatar whose file has since been
 * pruned from storage, which would otherwise render a broken-image glyph.
 */
export function MemberAvatar({
  src,
  name,
  email,
  className,
}: MemberAvatarProps) {
  const [broken, setBroken] = useState(false);

  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setBroken(true)}
        className={cn("size-9 shrink-0 rounded-full object-cover", className)}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full bg-gold-foil",
        "font-body text-xs font-bold text-night-deep",
        className,
      )}
    >
      {memberInitials(name, email)}
    </span>
  );
}
