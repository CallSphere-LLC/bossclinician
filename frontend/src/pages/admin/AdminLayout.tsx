import { publicSiteUrl } from "@/lib/siteOrigins";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ChevronDown,
  ExternalLink,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { Toaster } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/cn";
import { adminApi } from "@/lib/api";
import { pluralize } from "@/pages/admin/ui/friendly";
import { NAV_GROUPS, groupForPath, type NavGroup } from "@/pages/admin/ui/nav";
import { UploadTray } from "@/pages/admin/ui/UploadTray";
import { AdminVoiceMount } from "@/voice/surfaces/mount";
import { ConsoleThemeToggle } from "@/pages/admin/ui/ConsoleThemeToggle";

/**
 * Admin shell: dark rail + collapsible nav groups, glass topbar, content well.
 *
 * The rail is intentionally dark against the light content area — it pushes
 * chrome back and pulls the data forward, and it keeps the plum/gold brand
 * present on every screen without tinting the working surface.
 */
export function AdminLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [signOutError, setSignOutError] = useState("");
  const location = useLocation();
  const reduceMotion = useReducedMotion();

  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem("bc_admin_rail") === "collapsed";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  // Multiple groups stay open at once (not an accordion) — with eight sections
  // and frequent cross-section hopping, auto-collapsing the previous group
  // just costs an extra click every time.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const stored = localStorage.getItem("bc_admin_groups");
    // Guarded: a value this browser cannot parse would throw during render and
    // leave her with a blank admin on every load, with nowhere to click to
    // recover it.
    try {
      if (stored) return new Set(JSON.parse(stored) as string[]);
    } catch {
      // fall through to the default below
    }
    const active = groupForPath(location.pathname);
    return new Set(active ? [active] : ["products"]);
  });
  const [newLeads, setNewLeads] = useState(0);

  // Keep the active group expanded when navigating (e.g. via a dashboard link).
  useEffect(() => {
    const group = groupForPath(location.pathname);
    if (!group) return;
    setOpenGroups((prev) => (prev.has(group) ? prev : new Set(prev).add(group)));
  }, [location.pathname]);

  useEffect(() => {
    localStorage.setItem("bc_admin_groups", JSON.stringify([...openGroups]));
  }, [openGroups]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    localStorage.setItem("bc_admin_rail", collapsed ? "collapsed" : "expanded");
  }, [collapsed]);

  // Unread-style badge on the enquiries inbox.
  useEffect(() => {
    let cancelled = false;
    adminApi
      .stats()
      .then((s) => {
        if (!cancelled) setNewLeads(Number(s.newLeads ?? 0));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  const initials = useMemo(() => {
    const source = user?.name || user?.email || "";
    const parts = source.split(/[\s@.]+/).filter(Boolean);
    return (parts[0]?.[0] ?? "A").concat(parts[1]?.[0] ?? "").toUpperCase();
  }, [user]);

  const rail = (
    <nav
      aria-label="Main menu"
      className="flex h-full flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-base)] text-white/85"
    >
      {/* Brand */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center gap-2.5 border-b border-white/10",
          collapsed ? "justify-center px-3" : "px-5",
        )}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gold-foil font-display text-base font-bold text-night-deep shadow-[0_6px_16px_-6px_rgba(201,164,106,0.9)]">
          B
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate font-display text-[0.95rem] leading-tight text-white">
              Boss Clinician
            </p>
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-gold/85">
              Admin Studio
            </p>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2.5 py-4 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]">
        {NAV_GROUPS.map((group) => (
          <NavGroupItem
            key={group.id}
            group={group}
            collapsed={collapsed}
            open={openGroups.has(group.id)}
            onToggle={() =>
              setOpenGroups((prev) => {
                const next = new Set(prev);
                if (next.has(group.id)) next.delete(group.id);
                else next.add(group.id);
                return next;
              })
            }
            newLeads={newLeads}
            reduceMotion={Boolean(reduceMotion)}
          />
        ))}
      </div>

      {/* Account */}
      <div className="shrink-0 border-t border-white/10 p-2.5">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-white/10",
                collapsed && "justify-center",
              )}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gold-foil text-xs font-bold text-night-deep">
                {initials}
              </span>
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8rem] font-semibold text-white">
                      {user?.name || "Your account"}
                    </span>
                    <span className="block truncate text-[0.68rem] text-white/55">
                      {user?.email}
                    </span>
                  </span>
                  <ChevronDown className="size-4 shrink-0 text-white/50" />
                </>
              )}
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="top"
              align="start"
              sideOffset={8}
              className="z-50 min-w-[13rem] rounded-xl border border-hairline bg-surface-raised p-1.5 shadow-[0_24px_54px_-18px_rgba(0,0,0,0.85)]"
            >
              <DropdownMenu.Item asChild>
                <a
                  href={publicSiteUrl("/")}
                  target="_blank"
                  rel="noreferrer"
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink outline-none data-[highlighted]:bg-white/[0.07]"
                >
                  <ExternalLink className="size-4 text-ink-soft" />
                  Open my website
                </a>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-hairline" />
              <DropdownMenu.Item asChild>
                <button
                  type="button"
                  onClick={() => { void logout().catch(() => setSignOutError("Sign-out did not complete. Check your connection and try again.")); }}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-400 outline-none data-[highlighted]:bg-red-500/10"
                >
                  <LogOut className="size-4" />
                  Log out
                </button>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </nav>
  );

  return (
    <div className="theme-console min-h-screen bg-cream text-ink">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            borderRadius: "0.85rem",
            border: "1px solid var(--border-strong)",
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            fontFamily: "Montserrat, Arial, sans-serif",
          },
        }}
      />

      {/* Desktop rail */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden transition-[width] duration-150 ease-out lg:block",
          collapsed ? "w-[4.75rem]" : "w-[16.5rem]",
        )}
      >
        {rail}
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-40 bg-night-deep/75 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 34 }}
              className="fixed inset-y-0 left-0 z-50 w-[17rem] max-w-[85vw] lg:hidden"
            >
              {rail}
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close the menu"
                className="absolute -right-11 top-4 grid size-9 place-items-center rounded-full border border-hairline bg-surface-raised text-ink shadow-lg"
              >
                <X className="size-4" />
              </button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-150 ease-out",
          collapsed ? "lg:pl-[4.75rem]" : "lg:pl-[16.5rem]",
        )}
      >
        {/* Glass topbar */}
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-hairline bg-cream/90 px-4 backdrop-blur-xl lg:px-7">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open the menu"
            className="grid size-11 place-items-center rounded-xl border border-hairline text-ink-soft transition-colors hover:border-gold/45 hover:text-gold lg:hidden"
          >
            <Menu className="size-4" />
          </button>

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Widen the menu" : "Narrow the menu"}
            className="hidden size-9 place-items-center rounded-xl border border-hairline text-ink-soft transition-colors hover:border-plum/40 hover:text-plum lg:grid"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </button>

          {/* A dashboard-wide search box lived here, wired to nothing: it took
              what she typed, and pressing Enter did nothing at all. Each list
              screen has its own working search, so the honest thing is not to
              offer a second one until there is something behind it. */}

          <div className="ml-auto flex items-center gap-2.5">
            <Link
              to="/admin/leads"
              className="relative grid size-11 place-items-center rounded-xl border border-hairline text-ink-soft transition-colors hover:border-plum/40 hover:text-plum lg:size-9"
              aria-label={`Your enquiries${newLeads > 0 ? `, ${newLeads} new` : ""}`}
              title={
                newLeads > 0 ? pluralize(newLeads, "new enquiry", "new enquiries") : "Your enquiries"
              }
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="size-4" strokeWidth={1.8}>
                <path d="M3.5 13.5 6 5.5h12l2.5 8v5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" strokeLinejoin="round" />
                <path d="M3.5 13.5h4.5l1 2h6l1-2h4.5" strokeLinejoin="round" />
              </svg>
              {newLeads > 0 && (
                <span className="absolute -right-1 -top-1 grid min-w-[1.15rem] place-items-center rounded-full bg-gold px-1 text-[0.62rem] font-bold text-ink">
                  {newLeads > 99 ? "99+" : newLeads}
                </span>
              )}
            </Link>

            <a
              href={publicSiteUrl("/")}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-xl border border-hairline px-3.5 py-2 text-xs font-semibold text-ink-soft transition-colors hover:border-plum/40 hover:text-plum sm:flex"
            >
              My website
              <ExternalLink className="size-3.5" />
            </a>

            <ConsoleThemeToggle />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 lg:px-7 lg:py-8">
          <motion.div
            key={location.pathname}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto max-w-[86rem]"
          >
            {signOutError && <p role="alert" className="p-4 text-red-400">{signOutError}</p>}
          {children}
          </motion.div>
        </main>
      </div>

      {/* Outside the routed content on purpose: an upload started on the media
          library has to keep running, and keep showing, while she works on a
          course three screens away. */}
      <UploadTray />

      {/* Alongside the upload tray, and for the same reason: a conversation
          begun on the dashboard has to keep running while the agent walks her
          to the page they are talking about. */}
      <AdminVoiceMount />
    </div>
  );
}

/* --------------------------------------------------------------- Nav group */

function NavGroupItem({
  group,
  collapsed,
  open,
  onToggle,
  newLeads,
  reduceMotion,
}: {
  group: NavGroup;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  newLeads: number;
  reduceMotion: boolean;
}) {
  const Icon = group.icon;
  const location = useLocation();

  // Single-destination group (Dashboard, Settings).
  if (group.to) {
    const active = group.end
      ? location.pathname === group.to
      : location.pathname.startsWith(group.to);
    return (
      <NavLink
        to={group.to}
        end={group.end}
        title={collapsed ? group.label : undefined}
        className={cn(
          "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
          collapsed && "justify-center px-0",
          active ? "bg-surface text-ink" : "text-white/70 hover:bg-white/8 hover:text-white",
        )}
      >
        {active && (
          <motion.span
            layoutId="rail-active"
            className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-gold"
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          />
        )}
        <Icon className="size-[1.15rem] shrink-0" />
        {!collapsed && group.label}
      </NavLink>
    );
  }

  const groupActive = group.children?.some((c) => location.pathname.startsWith(c.to)) ?? false;

  // Collapsed rail: expanding in place would have nowhere to go, so the group
  // becomes a flyout menu instead.
  if (collapsed) {
    return (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            title={group.label}
            className={cn(
              "flex w-full items-center justify-center rounded-xl py-2.5 transition-colors",
              groupActive ? "bg-surface text-ink" : "text-white/70 hover:bg-white/8",
            )}
          >
            <Icon className="size-[1.15rem]" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="right"
            align="start"
            sideOffset={10}
            className="z-50 min-w-[12rem] rounded-xl border border-hairline bg-surface-raised p-1.5 shadow-[0_24px_54px_-18px_rgba(0,0,0,0.85)]"
          >
            <DropdownMenu.Label className="px-3 py-1.5 text-[0.66rem] font-bold uppercase tracking-[0.14em] text-ink-soft">
              {group.label}
            </DropdownMenu.Label>
            {group.children?.map((child) => (
              <DropdownMenu.Item key={child.to} asChild>
                <Link
                  to={child.to}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-ink outline-none data-[highlighted]:bg-lilac-tint"
                >
                  {child.label}
                  {child.badge === "leads" && newLeads > 0 && (
                    <span className="rounded-full bg-gold px-1.5 text-[0.62rem] font-bold text-ink">
                      {newLeads}
                    </span>
                  )}
                </Link>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
          groupActive ? "text-white" : "text-white/70 hover:bg-white/8 hover:text-white",
        )}
      >
        <Icon className="size-[1.15rem] shrink-0" />
        <span className="flex-1 text-left">{group.label}</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
          className="shrink-0"
        >
          <ChevronDown className="size-4 text-white/45" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="ml-[1.6rem] mt-0.5 space-y-0.5 border-l border-white/12 pl-2.5">
              {group.children?.map((child) => (
                <li key={child.to}>
                  <NavLink
                    to={child.to}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[0.82rem] transition-colors",
                        isActive
                          ? "bg-surface font-semibold text-ink before:-ml-3 before:h-5 before:w-0.5 before:rounded-full before:bg-gold"
                          : "text-white/60 hover:bg-white/8 hover:text-white",
                      )
                    }
                  >
                    <span className="flex items-center gap-2">
                      {child.label}
                      {!child.ready && (
                        <span className="rounded bg-white/12 px-1.5 py-0.5 text-[0.58rem] font-semibold uppercase tracking-wide text-white/55">
                          Soon
                        </span>
                      )}
                    </span>
                    {child.badge === "leads" && newLeads > 0 && (
                      <span className="rounded-full bg-gold px-1.5 text-[0.62rem] font-bold text-ink">
                        {newLeads}
                      </span>
                    )}
                  </NavLink>
                </li>
              ))}
            </div>
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
