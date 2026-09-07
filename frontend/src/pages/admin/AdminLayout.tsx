import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ChevronDown,
  CircleHelp,
  ExternalLink,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  User,
  X,
} from "lucide-react";
import { Toaster } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/cn";
import { adminApi } from "@/lib/api";
import { pluralize } from "@/pages/admin/ui/friendly";
import {
  NAV_GROUPS,
  groupForPath,
  pageHeadingForPath,
  type NavGroup,
} from "@/pages/admin/ui/nav";
import { ThemeToggle } from "@/pages/admin/ui/ThemeToggle";
import { GlobalSearch } from "@/pages/admin/ui/GlobalSearch";
import { QuickCreate } from "@/pages/admin/ui/QuickCreate";
import { NotificationsMenu, useNotifications } from "@/pages/admin/ui/NotificationsMenu";
import { InboxMenu, useInbox } from "@/pages/admin/ui/InboxMenu";
import { useConsoleTheme } from "@/pages/admin/ui/theme";

/**
 * The console shell — Part II §4, §5, §10.
 *
 * Fixed collapsible rail, sticky header, scrolling content well.
 *
 * The rail used to be a fixed dark gradient with `text-white` on it, which is
 * a reasonable choice for a console that is only ever dark and the wrong one
 * the moment there is a light theme: §7 asks for a sidebar that is a *deeper*
 * neutral than an ivory page, and §8 for one that is a *lighter* charcoal than
 * a near-black page. It inverts its relationship to the content, so it cannot
 * borrow the surface scale and has its own `rail-*` tokens instead.
 */
export function AdminLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const { theme } = useConsoleTheme();

  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem("bc_admin_rail") === "collapsed";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  // Multiple groups stay open at once (not an accordion) — with this many
  // sections and frequent cross-section hopping, auto-collapsing the previous
  // group just costs an extra click every time.
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
    return new Set(active ? [active] : ["contacts"]);
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

  // Unread-style badge on the applications inbox.
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

  // Refetched on navigation rather than polled: the operator moving around the
  // console is a far better signal that something may have happened than a
  // timer, and it costs no request while she is reading one screen.
  const notifications = useNotifications(location.pathname);
  // §3 — the Inbox lives in the global header, on every page.
  const conversations = useInbox(location.pathname);

  const initials = useMemo(() => {
    const source = user?.name || user?.email || "";
    const parts = source.split(/[\s@.]+/).filter(Boolean);
    return (parts[0]?.[0] ?? "A").concat(parts[1]?.[0] ?? "").toUpperCase();
  }, [user]);

  const heading = pageHeadingForPath(location.pathname);

  const rail = (
    <nav aria-label="Main menu" className="flex h-full flex-col bg-rail text-rail-text">
      {/* Brand */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center gap-2.5 border-b border-rail-line",
          collapsed ? "justify-center px-3" : "px-5",
        )}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-solid font-display text-base font-bold text-accent-on">
          B
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate font-display text-[0.95rem] leading-tight text-rail-text">
              Boss Clinician
            </p>
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-accent">
              Admin
            </p>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3 [scrollbar-width:thin]">
        {NAV_GROUPS.map((group) => (
          <Fragment key={group.id}>
            {/* §5's section headings. Hidden when the rail is collapsed to an
                icon strip, where a caption has nowhere to go — the groups stay
                in the same order, so the grouping still reads. */}
            {group.section && !collapsed && (
              <p className="px-3 pb-1 pt-4 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-rail-dim">
                {group.section}
              </p>
            )}
            {group.section && collapsed && <hr className="mx-3 my-2 border-rail-line" />}
            <NavGroupItem
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
          </Fragment>
        ))}
      </div>

      {/* Account */}
      <div className="shrink-0 border-t border-rail-line p-2.5">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-rail-raised",
                collapsed && "justify-center",
              )}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-solid text-xs font-bold text-accent-on">
                {initials}
              </span>
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8rem] font-semibold text-rail-text">
                      {user?.name || "Your account"}
                    </span>
                    <span className="block truncate text-[0.68rem] text-rail-dim">
                      {user?.email}
                    </span>
                  </span>
                  <ChevronDown aria-hidden className="size-4 shrink-0 text-rail-dim" />
                </>
              )}
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <ProfileMenuContent side="top" align="start" onLogout={logout} />
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-cream text-ink">
      <Toaster
        position="top-right"
        // Sonner paints its own surface, so it has to be told which one — left
        // to itself it renders a light toast over a charcoal console.
        theme={theme}
        toastOptions={{
          style: {
            borderRadius: "0.75rem",
            fontFamily: "Montserrat, Arial, sans-serif",
          },
        }}
      />

      {/* Desktop rail */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden transition-[width] duration-300 ease-out lg:block",
          collapsed ? "w-[4.75rem]" : "w-[16.5rem]",
        )}
      >
        {rail}
      </aside>

      {/* Mobile drawer (§4, §52) */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 34 }}
              className="fixed inset-y-0 left-0 z-50 w-[17rem] lg:hidden"
            >
              {rail}
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close the menu"
                className="absolute -right-11 top-4 grid size-9 place-items-center rounded-full border border-hairline bg-surface-raised text-ink shadow-console-pop"
              >
                <X aria-hidden className="size-4" />
              </button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-300 ease-out",
          collapsed ? "lg:pl-[4.75rem]" : "lg:pl-[16.5rem]",
        )}
      >
        {/* §10 — top header */}
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-hairline bg-cream/92 px-4 backdrop-blur-xl lg:px-7">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open the menu"
            className="grid size-10 shrink-0 place-items-center rounded-xl border border-hairline text-ink-soft transition-colors hover:border-accent/45 hover:text-accent lg:hidden"
          >
            <Menu aria-hidden className="size-4" />
          </button>

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Widen the menu" : "Narrow the menu"}
            className="hidden size-9 shrink-0 place-items-center rounded-xl border border-hairline text-ink-soft transition-colors hover:border-accent/45 hover:text-accent lg:grid"
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden className="size-4" />
            ) : (
              <PanelLeftClose aria-hidden className="size-4" />
            )}
          </button>

          {/* Page title and subtitle. Hidden below `md` so the search box has
              room on a phone — the rail already says where she is. */}
          <div className="hidden min-w-0 md:block">
            <p className="truncate text-[0.92rem] font-semibold leading-tight text-ink">
              {heading.title}
            </p>
            <p className="truncate text-[0.72rem] text-ink-soft">{heading.subtitle}</p>
          </div>

          <GlobalSearch className="ml-auto w-full max-w-[24rem] md:ml-6" />

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <QuickCreate />
            <InboxMenu conversations={conversations} />
            <NotificationsMenu notifications={notifications} />

            <a
              href="https://github.com/shankasf/bossclinician#readme"
              target="_blank"
              rel="noreferrer"
              aria-label="Help"
              title="Help"
              className="hidden size-9 place-items-center rounded-xl border border-hairline text-ink-soft transition-colors hover:border-accent/45 hover:text-accent sm:grid"
            >
              <CircleHelp aria-hidden className="size-4" />
            </a>

            <ThemeToggle />

            {/* The profile menu is duplicated here and in the rail foot on
                purpose: §10 puts it in the header, and the rail's copy is the
                one that survives the rail being the only thing on screen. */}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  aria-label="Your account"
                  className="grid size-9 place-items-center rounded-full bg-accent-solid text-[0.7rem] font-bold text-accent-on"
                >
                  {initials}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <ProfileMenuContent side="bottom" align="end" onLogout={logout} />
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-7 lg:py-8">
          <motion.div
            key={location.pathname}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto max-w-[92rem]"
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Profile menu */

/** §10's profile dropdown: Profile, Account, Settings, Sign Out. */
function ProfileMenuContent({
  side,
  align,
  onLogout,
}: {
  side: "top" | "bottom";
  align: "start" | "end";
  onLogout: () => void;
}) {
  return (
    <DropdownMenu.Content
      side={side}
      align={align}
      sideOffset={8}
      className="z-50 min-w-[13.5rem] rounded-xl border border-hairline bg-surface-raised p-1.5 shadow-console-pop"
    >
      <DropdownMenu.Item asChild>
        <Link
          to="/admin/settings/team"
          className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink outline-none data-[highlighted]:bg-raise"
        >
          <User aria-hidden className="size-4 text-ink-soft" />
          Profile &amp; security
        </Link>
      </DropdownMenu.Item>
      <DropdownMenu.Item asChild>
        <Link
          to="/admin/settings"
          className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink outline-none data-[highlighted]:bg-raise"
        >
          <Settings aria-hidden className="size-4 text-ink-soft" />
          Settings
        </Link>
      </DropdownMenu.Item>
      <DropdownMenu.Item asChild>
        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink outline-none data-[highlighted]:bg-raise"
        >
          <ExternalLink aria-hidden className="size-4 text-ink-soft" />
          Open my website
        </a>
      </DropdownMenu.Item>
      <DropdownMenu.Separator className="my-1 h-px bg-hairline" />
      <DropdownMenu.Item asChild>
        <button
          type="button"
          onClick={onLogout}
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-neg outline-none data-[highlighted]:bg-neg-soft"
        >
          <LogOut aria-hidden className="size-4" />
          Sign out
        </button>
      </DropdownMenu.Item>
    </DropdownMenu.Content>
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

  // Single-destination group (Dashboard, Offers, Settings…).
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
          // §5: active items are clearly highlighted "without large coloured
          // backgrounds" — a rail-surface fill and an accent edge, not a slab
          // of brand colour.
          active
            ? "bg-rail-raised text-rail-text"
            : "text-rail-dim hover:bg-rail-raised hover:text-rail-text",
        )}
      >
        {active && (
          <motion.span
            layoutId="rail-active"
            aria-hidden
            className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-accent"
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          />
        )}
        <Icon aria-hidden className="size-[1.15rem] shrink-0" />
        {!collapsed && <span className="flex-1">{group.label}</span>}
        {/* Enquiries carries the same unread-style count the group used to. */}
        {!collapsed && group.badge === "leads" && newLeads > 0 && (
          <span
            className="rounded-full bg-accent-solid px-1.5 font-numeric text-[0.62rem] font-bold text-accent-on"
            title={pluralize(newLeads, "new enquiry", "new enquiries")}
          >
            {newLeads}
          </span>
        )}
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
            aria-label={group.label}
            className={cn(
              "flex w-full items-center justify-center rounded-xl py-2.5 transition-colors",
              groupActive
                ? "bg-rail-raised text-rail-text"
                : "text-rail-dim hover:bg-rail-raised hover:text-rail-text",
            )}
          >
            <Icon aria-hidden className="size-[1.15rem]" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="right"
            align="start"
            sideOffset={10}
            className="z-50 min-w-[12rem] rounded-xl border border-hairline bg-surface-raised p-1.5 shadow-console-pop"
          >
            <DropdownMenu.Label className="px-3 py-1.5 text-[0.66rem] font-bold uppercase tracking-[0.14em] text-ink-soft">
              {group.label}
            </DropdownMenu.Label>
            {group.children?.map((child) => (
              <DropdownMenu.Item key={child.to} asChild>
                <Link
                  to={child.to}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-ink outline-none data-[highlighted]:bg-raise"
                >
                  {child.label}
                  {child.badge === "leads" && newLeads > 0 && (
                    <span className="rounded-full bg-accent-solid px-1.5 font-numeric text-[0.62rem] font-bold text-accent-on">
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
          groupActive
            ? "text-rail-text"
            : "text-rail-dim hover:bg-rail-raised hover:text-rail-text",
        )}
      >
        <Icon aria-hidden className="size-[1.15rem] shrink-0" />
        <span className="flex-1 text-left">{group.label}</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
          aria-hidden
          className="shrink-0"
        >
          <ChevronDown className="size-4 text-rail-dim" />
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
            <div className="ml-[1.6rem] mt-0.5 space-y-0.5 border-l border-rail-line pl-2.5">
              {group.children?.map((child) => (
                <li key={child.to}>
                  <NavLink
                    to={child.to}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[0.82rem] transition-colors",
                        isActive
                          ? "bg-rail-raised font-semibold text-rail-text"
                          : "text-rail-dim hover:bg-rail-raised hover:text-rail-text",
                      )
                    }
                  >
                    <span className="flex items-center gap-2">
                      {child.label}
                      {!child.ready && (
                        <span className="rounded bg-rail-raised px-1.5 py-0.5 text-[0.58rem] font-semibold uppercase tracking-wide text-rail-dim">
                          Soon
                        </span>
                      )}
                    </span>
                    {child.badge === "leads" && newLeads > 0 && (
                      <span className="rounded-full bg-accent-solid px-1.5 font-numeric text-[0.62rem] font-bold text-accent-on">
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
