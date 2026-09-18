import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { Link, useLocation } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import type { NavBadgeTone, NavMenu } from "@/content/site";

/**
 * Badge pill tints from the design.
 *
 * The green pill's text is lightened from the brand `--green` (#4A7C6B) to
 * #6FA894: on the navy panel the original only reaches 2.8:1, the lightened
 * hue clears WCAG AA (5.4:1) at the pill's 0.55rem size.
 */
export const navBadgeTone: Record<NavBadgeTone, string> = {
  green: "bg-[rgba(74,124,107,0.2)] text-[#6FA894]",
  plum: "bg-[rgba(92,69,125,0.2)] text-lilac",
  gold: "bg-[rgba(201,164,106,0.2)] text-gold",
};

export const navBadgeClass =
  "shrink-0 rounded-full px-[7px] py-[2px] text-[0.55rem] font-bold uppercase leading-[1.6] tracking-[0.1em]";

/** True when `pathname` is `to` itself or a page beneath it (/blog/my-post). */
export function isPathWithin(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** A menu is "current" when the page being read is one of its children. */
export function isMenuActive(menu: NavMenu, pathname: string): boolean {
  return menu.items.some((item) => isPathWithin(pathname, item.to));
}

/** How long the pointer may be outside the menu before it closes. */
const HOVER_CLOSE_DELAY_MS = 150;

interface NavDropdownProps {
  menu: NavMenu;
  /** Controlled by the header so that only one menu is ever open. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Which edge of the trigger the panel hangs from. `end` keeps a menu that
   * sits last in the bar from running off the right of the viewport.
   */
  align?: "center" | "end";
}

/**
 * A desktop header menu — an APG disclosure, not a `:hover`-only panel.
 *
 * Opens on mouse hover, on click/tap, and on Enter/Space/ArrowDown; closes on
 * Escape (restoring focus), on outside pointer-down, when focus leaves, and —
 * because the header owns `open` — on a route change or when a sibling opens.
 */
export function NavDropdown({ menu, open, onOpenChange, align = "center" }: NavDropdownProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pointerType = useRef<string>("mouse");
  const closeTimer = useRef<number | null>(null);
  /** Set by ArrowDown/ArrowUp on the trigger: which item takes focus on open. */
  const focusOnOpen = useRef<"first" | "last" | null>(null);
  const panelId = useId();
  const prefersReducedMotion = useReducedMotion();
  const { pathname } = useLocation();
  const active = isMenuActive(menu, pathname);

  const cancelClose = () => {
    if (closeTimer.current === null) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  useEffect(() => cancelClose, []);

  const panelLinks = useCallback(
    () => Array.from(panelRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? []),
    [],
  );

  useEffect(() => {
    if (!open) {
      focusOnOpen.current = null;
      return;
    }

    if (focusOnOpen.current) {
      const links = panelLinks();
      (focusOnOpen.current === "first" ? links[0] : links[links.length - 1])?.focus();
      focusOnOpen.current = null;
    }

    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Hand focus back only if it was in here; a hover-opened menu must not
      // pull focus away from whatever the visitor was typing in.
      const hadFocus = rootRef.current?.contains(document.activeElement) ?? false;
      onOpenChange(false);
      if (hadFocus) triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange, panelLinks]);

  const handlePointerEnter = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;
    cancelClose();
    onOpenChange(true);
  };

  // A short grace period, so a diagonal path from the trigger to the panel —
  // or a slip past its edge — does not snap the menu shut.
  const handlePointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      onOpenChange(false);
    }, HOVER_CLOSE_DELAY_MS);
  };

  const handleTriggerClick = (event: MouseEvent<HTMLButtonElement>) => {
    cancelClose();
    // detail === 0 means the click came from Enter/Space, not a pointer.
    const fromKeyboard = event.detail === 0;
    // Hovering with a mouse already opened it — don't toggle it shut.
    if (!fromKeyboard && pointerType.current === "mouse" && open) return;
    onOpenChange(!open);
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const target = event.key === "ArrowDown" ? "first" : "last";
    if (open) {
      const links = panelLinks();
      (target === "first" ? links[0] : links[links.length - 1])?.focus();
      return;
    }
    focusOnOpen.current = target;
    onOpenChange(true);
  };

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const { key } = event;
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;
    const links = panelLinks();
    if (links.length === 0) return;
    event.preventDefault();
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    let next = 0;
    if (key === "End") next = links.length - 1;
    else if (key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % links.length;
    else if (key === "ArrowUp") next = index <= 0 ? links.length - 1 : index - 1;
    links[next]?.focus();
  };

  const close = () => {
    cancelClose();
    onOpenChange(false);
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        onPointerDown={(event) => {
          pointerType.current = event.pointerType;
        }}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          "group relative flex items-center gap-[6px] whitespace-nowrap py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] transition-colors duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold",
          open || active ? "text-white" : "text-white/55 hover:text-white",
        )}
      >
        {menu.label}
        <span
          aria-hidden
          className={cn(
            "text-[0.55rem] leading-none text-gold transition-transform duration-300 ease-luxe",
            open && "rotate-180",
          )}
        >
          ▾
        </span>
        <span
          aria-hidden
          className={cn(
            "absolute -bottom-0.5 left-0 h-px w-full origin-center bg-rule-gold transition-transform duration-500 ease-luxe",
            open || active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100",
          )}
        />
      </button>

      {/* The gap between trigger and panel is PADDING on this wrapper, not a
          margin: the pointer stays inside the menu's box all the way down. */}
      <div
        className={cn(
          "absolute top-full z-50 pt-3.5",
          align === "end" ? "right-0" : "left-1/2 -translate-x-1/2",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panelRef}
              id={panelId}
              onKeyDown={handlePanelKeyDown}
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: prefersReducedMotion ? 0.12 : 0.18, ease: [0.22, 1, 0.36, 1] }}
              // Theme tokens throughout: `bg-night-raised` turns white on the
              // light theme and `ink`/`orchid-dim` turn dark with it, where
              // `text-white` and a white veil would only be partly remapped.
              className="relative w-max min-w-[20rem] max-w-[24rem] rounded-2xl border border-white/10 bg-night-raised p-2 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)]"
            >
              <span
                aria-hidden
                className={cn(
                  "absolute -top-[6px] h-2.5 w-2.5 rotate-45 border-l border-t border-white/10 bg-night-raised",
                  align === "end" ? "right-8" : "left-1/2 -translate-x-1/2",
                )}
              />
              {menu.description && (
                <p className="relative px-4 pb-1.5 pt-2.5 text-[0.6rem] font-bold uppercase tracking-[0.2em] text-gold/75">
                  {menu.description}
                </p>
              )}
              <ul aria-label={menu.label} className="relative">
                {menu.items.map((item) => {
                  const current = pathname === item.to;
                  return (
                    <li key={item.label}>
                      <Link
                        to={item.to}
                        aria-current={current ? "page" : undefined}
                        onClick={close}
                        className={cn(
                          "group flex flex-col gap-0.5 rounded-xl px-4 py-2.5 transition-colors duration-300 ease-luxe hover:bg-ink/[0.05] focus-visible:bg-ink/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gold",
                          current && "bg-ink/[0.05]",
                        )}
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span
                            className={cn(
                              "whitespace-nowrap text-[0.86rem] font-semibold tracking-[0.01em] transition-colors duration-300",
                              current ? "text-gold" : "text-ink group-hover:text-gold",
                            )}
                          >
                            {item.label}
                          </span>
                          {item.badge && (
                            <span className={cn(navBadgeClass, navBadgeTone[item.badgeTone ?? "gold"])}>
                              {item.badge}
                            </span>
                          )}
                        </span>
                        <span className="whitespace-normal text-[0.76rem] leading-snug text-orchid-dim">
                          {item.description}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>

              {menu.footer && menu.footer.length > 0 && (
                <div className="relative mt-2 flex items-center justify-between gap-4 border-t border-white/10 px-4 pb-1 pt-2">
                  {menu.footer.map((link) => {
                    const className =
                      "inline-flex min-h-[2.25rem] items-center gap-1.5 whitespace-nowrap text-[0.64rem] font-bold uppercase tracking-[0.16em] text-gold underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";
                    return link.to !== undefined ? (
                      <Link key={link.label} to={link.to} onClick={close} className={className}>
                        {link.label}
                        <span aria-hidden>→</span>
                      </Link>
                    ) : (
                      <a
                        key={link.label}
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={close}
                        className={className}
                      >
                        {link.label}
                        <span aria-hidden>↗</span>
                      </a>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
