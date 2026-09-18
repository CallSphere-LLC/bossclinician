import { SiteThemeToggle } from "@/components/layout/SiteThemeToggle";
import { useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Toaster } from "sonner";
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  Eye,
  LogOut,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { useMember } from "@/hooks/useMember";
import { TimezonePrompt } from "@/components/member/TimezonePrompt";
import { cn } from "@/lib/cn";

/**
 * Chrome for every signed-in member page.
 *
 * Deliberately not AdminLayout. The admin console is a workplace — dense rail,
 * light working surface, tool affordances everywhere. This is the product the
 * member paid for, so it stays on the Obsidian Luxe brand: the same near-black
 * field, foil hairlines and Playfair headings as the public site, with the
 * chrome pared back to a slim bar and a quiet rail so the content is the
 * loudest thing on screen.
 *
 * It carries its own `theme-luxe` wrapper rather than leaning on Layout,
 * because the member area supplies its own header and has no marketing footer.
 */

interface MemberShellProps {
  title: string;
  description?: string;
  /** Page-level actions: beside the title on desktop, beneath it on mobile. */
  actions?: ReactNode;
  children: ReactNode;
}

interface RailLink {
  to: string;
  label: string;
  icon: typeof BookOpen;
}

const RAIL: RailLink[] = [
  { to: "/library", label: "Library", icon: BookOpen },
  { to: "/community", label: "Community", icon: Users },
  { to: "/coaching", label: "Coaching", icon: Sparkles },
  // Between coaching and account, because it is a thing you attend rather than
  // a setting you change.
  { to: "/my-events", label: "Events", icon: CalendarDays },
  { to: "/account", label: "Account", icon: User },
];

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
export function MemberAvatar({ src, name, email, className }: MemberAvatarProps) {
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

export function MemberShell({ title, description, actions, children }: MemberShellProps) {
  const { member, signOut } = useMember();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="theme-luxe grain-overlay flex min-h-screen flex-col bg-night-deep">
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            borderRadius: "0.85rem",
            border: "1px solid rgba(255,255,255,0.10)",
            background: "#100B1C",
            color: "#F5F1FA",
            fontFamily: "Montserrat, Arial, sans-serif",
          },
        }}
      />

      <a
        href="#member-content"
        className={cn(
          "sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]",
          "focus:rounded-full focus:bg-gold focus:px-5 focus:py-2.5",
          "focus:text-sm focus:font-semibold focus:text-night-deep",
        )}
      >
        Skip to main content
      </a>

      {/* Banner, bar and mobile strip stick as a single block. Stacking them as
          separate `top-0` siblings would slide them over one another, and any
          fixed offset between them breaks the moment the banner wraps to two
          lines on a narrow phone. */}
      <div className="sticky top-0 z-40">
        {member?.impersonatedBy != null && <ImpersonationBanner />}

        <header className="relative border-b border-white/[0.07] bg-night-deep/[0.94] backdrop-blur-xl backdrop-saturate-150">
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-rule-gold opacity-40" />

          <div className="mx-auto flex h-16 w-full max-w-8xl items-center justify-between gap-4 px-5 sm:px-8 lg:px-12">
            <Link
              to="/"
              className="font-display text-[1.05rem] font-bold leading-none tracking-[0.03em] text-white"
            >
              Boss <em className="text-foil italic">Clinician</em>
            </Link>

            <SiteThemeToggle />

            {member && (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex min-h-[2.75rem] items-center gap-2.5 rounded-full py-1 pl-1 pr-3",
                      "transition-colors duration-300 hover:bg-white/[0.06]",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                    )}
                    aria-label="Your account menu"
                  >
                    <MemberAvatar src={member.avatarUrl} name={member.name} email={member.email} />
                    <span className="hidden max-w-[11rem] truncate text-sm font-medium text-white/85 sm:block">
                      {member.name || member.email}
                    </span>
                    <ChevronDown aria-hidden className="size-4 shrink-0 text-white/45" />
                  </button>
                </DropdownMenu.Trigger>

                <DropdownMenu.Portal>
                  {/* The portal escapes `.theme-luxe`, so this menu names its
                      own dark colours instead of the themeable surface tokens,
                      which would otherwise resolve to the light palette. */}
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={10}
                    className="z-50 min-w-[15rem] rounded-2xl border border-white/10 bg-night-raised p-1.5 shadow-[0_28px_60px_-20px_rgba(0,0,0,0.9)]"
                  >
                    <div className="px-3 py-2.5">
                      <p className="truncate text-sm font-semibold text-white">
                        {member.name || "Your account"}
                      </p>
                      <p className="truncate text-xs text-orchid-dim">{member.email}</p>
                    </div>
                    <DropdownMenu.Separator className="my-1 h-px bg-white/10" />
                    <DropdownMenu.Item asChild>
                      <Link
                        to="/account"
                        className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-white/85 outline-none data-[highlighted]:bg-white/[0.07]"
                      >
                        <User aria-hidden className="size-4 text-gold" />
                        Account
                      </Link>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item asChild>
                      <button
                        type="button"
                        onClick={() => void handleSignOut()}
                        className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-white/85 outline-none data-[highlighted]:bg-white/[0.07]"
                      >
                        <LogOut aria-hidden className="size-4 text-orchid-dim" />
                        Sign out
                      </button>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            )}
          </div>
        </header>

        {/* Mobile gets the same four destinations as a scrollable strip. A
            drawer would put the member's own account an extra tap away on the
            device most of this audience reads on. */}
        <nav
          aria-label="Member sections"
          className="border-b border-white/[0.06] bg-night-deep/[0.94] backdrop-blur-xl lg:hidden"
        >
          <ul className="flex snap-x gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {RAIL.map((item) => (
              <li key={item.to} className="snap-start">
                <NavLink to={item.to} className={mobileLinkClass}>
                  <item.icon aria-hidden className="size-4" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="mx-auto flex w-full max-w-8xl flex-1 gap-10 px-5 pb-24 pt-8 sm:px-8 lg:gap-14 lg:px-12 lg:pt-12">
        <nav aria-label="Member sections" className="hidden w-56 shrink-0 lg:block">
          <ul className="sticky top-28 flex flex-col gap-1">
            {RAIL.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} className={railLinkClass}>
                  {({ isActive }) => (
                    <>
                      <span
                        aria-hidden
                        className={cn(
                          "absolute inset-y-2 left-0 w-px origin-center bg-rule-gold transition-transform duration-500 ease-luxe",
                          isActive ? "scale-y-100" : "scale-y-0",
                        )}
                      />
                      <item.icon
                        aria-hidden
                        className={cn("size-4 shrink-0", isActive ? "text-gold" : "text-orchid-dim")}
                      />
                      {item.label}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main id="member-content" className="min-w-0 flex-1">
          {/* Renders nothing unless the device and the saved time zone disagree. */}
          <TimezonePrompt className="mb-8" />

          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
            <div className="min-w-0">
              <h1 className="text-balance font-display text-[1.9rem] font-medium leading-[1.15] text-white sm:text-[2.4rem]">
                {title}
              </h1>
              {description && <p className="copy-luxe mt-3 max-w-xl text-balance">{description}</p>}
            </div>
            {actions && <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>}
          </div>

          <div aria-hidden className="rule-faint mt-7 w-full" />

          <div className="mt-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

function mobileLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    "inline-flex min-h-[2.75rem] items-center gap-2 whitespace-nowrap rounded-full px-4",
    "text-[0.7rem] font-semibold uppercase tracking-[0.14em] transition-colors duration-300",
    isActive ? "bg-gold/[0.12] text-gold" : "text-white/55 hover:text-white",
  );
}

function railLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    "relative flex min-h-[2.75rem] items-center gap-3 rounded-xl pl-5 pr-4",
    "text-[0.72rem] font-semibold uppercase tracking-[0.16em] transition-colors duration-300",
    isActive ? "bg-white/[0.05] text-white" : "text-white/50 hover:bg-white/[0.03] hover:text-white",
  );
}

/**
 * Impersonation banner.
 *
 * Amber on near-black, full width, above the bar and never scrolled away: an
 * admin who forgets they are inside somebody else's account can change that
 * member's password or read their private messages believing the account is
 * their own. The one thing this banner must never be is tasteful.
 */
function ImpersonationBanner() {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 bg-amber-400 px-5 py-3 text-center"
    >
      <Eye aria-hidden className="size-4 shrink-0 text-amber-950" />
      <p className="text-[0.78rem] font-bold uppercase tracking-[0.14em] text-amber-950">
        You are viewing this account as an administrator.
      </p>
    </div>
  );
}
