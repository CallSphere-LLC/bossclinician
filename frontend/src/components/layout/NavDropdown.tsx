import { useEffect, useId, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { Link } from "react-router-dom";
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

interface NavDropdownProps {
  menu: NavMenu;
}

/**
 * Desktop "Learn" menu — an APG disclosure, not a `:hover`-only panel.
 * Opens on mouse hover, on click/tap, and on keyboard activation; closes on
 * Escape (restoring focus), on outside pointer-down, and when focus leaves.
 */
export function NavDropdown({ menu }: NavDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pointerType = useRef<string>("mouse");
  const panelId = useId();
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handlePointerEnter = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") setOpen(true);
  };

  const handlePointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") setOpen(false);
  };

  const handleTriggerClick = (event: MouseEvent<HTMLButtonElement>) => {
    // detail === 0 means the click came from Enter/Space, not a pointer.
    const fromKeyboard = event.detail === 0;
    // Hovering with a mouse already opened it — don't toggle it shut.
    if (!fromKeyboard && pointerType.current === "mouse" && open) return;
    setOpen((v) => !v);
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
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
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "group relative flex items-center gap-[6px] py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] transition-colors duration-300",
          open ? "text-white" : "text-white/55 hover:text-white",
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
            open ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100",
          )}
        />
      </button>

      <div
        className={cn(
          "absolute left-1/2 top-full z-50 -translate-x-1/2 pt-3.5",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <AnimatePresence>
          {open && (
            <motion.div
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: prefersReducedMotion ? 0.12 : 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="glass glass-edge relative min-w-[262px] rounded-2xl py-2"
            >
              <span
                aria-hidden
                className="absolute -top-[6px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-l border-t border-white/15 bg-night-raised"
              />
              <ul id={panelId} aria-label={menu.label} className="relative">
                {menu.items.map((item, i) => (
                  <li key={item.label}>
                    <span className="block px-5 pb-1 pt-2.5 text-[0.6rem] font-bold uppercase tracking-[0.2em] text-gold/75">
                      {item.group}
                    </span>
                    <Link
                      to={item.to}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center justify-between gap-3 whitespace-nowrap px-5 py-[11px] text-[0.74rem] font-medium uppercase tracking-[0.08em] text-white/65 transition-colors duration-300 hover:bg-gold/[0.07] hover:text-gold focus-visible:bg-gold/[0.07] focus-visible:text-gold",
                        i < menu.items.length - 1 && "border-b border-white/[0.05]",
                      )}
                    >
                      <span>{item.label}</span>
                      <span className={cn(navBadgeClass, navBadgeTone[item.badgeTone])}>
                        {item.badge}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
