import { SiteThemeToggle } from "./SiteThemeToggle";
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Container } from "@/components/ui/Container";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { NavDropdown, isMenuActive } from "@/components/layout/NavDropdown";
import { headerActions, isNavMenu, nav, type NavMenu } from "@/content/site";
import { cn } from "@/lib/cn";
import { ShoppingCart } from "lucide-react";
import { readCart } from "@/lib/cart";

interface HeaderProps {
  /**
   * On the dark theme the header floats over the hero's own light field, so it
   * starts fully transparent and only materialises into glass once the page
   * scrolls. Light-theme routes always need the solid bar — white nav text on
   * a cream page is invisible.
   */
  transparentAtTop?: boolean;
}

export function Header({ transparentAtTop = false }: HeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  // One desktop dropdown, and one mobile section, open at a time, so both
  // live here rather than in the menus themselves.
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileSection, setMobileSection] = useState<string | null>(null);
  const location = useLocation();
  const prefersReducedMotion = useReducedMotion();
  const [cartCount, setCartCount] = useState(0);
  useEffect(() => {
    const refresh = () => setCartCount(readCart().length);
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("bossclinician-cart", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("bossclinician-cart", refresh);
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
    setOpenMenu(null);
    setMobileSection(null);
  }, [location.pathname]);

  // A reopened sheet starts with every section closed.
  useEffect(() => {
    if (!open) setMobileSection(null);
  }, [open]);

  // An open mobile sheet must not scroll the page behind it.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const solid = scrolled || !transparentAtTop || open;

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-[background-color,box-shadow,backdrop-filter] duration-500 ease-luxe",
        // 0.8 alpha let bright headings ghost through the bar as they scrolled
        // under it. 0.94 keeps the glass read while staying legible on the dark
        // theme; the blur does the rest of the work.
        solid
          ? "border-b border-white/[0.07] bg-night-deep/[0.94] backdrop-blur-xl backdrop-saturate-150"
          : "border-b border-transparent bg-transparent",
        scrolled && "shadow-[0_18px_50px_-20px_rgba(0,0,0,0.9)]",
      )}
    >
      {/* Foil hairline along the bottom edge — the one piece of gold in the
          chrome, and what makes the bar read as trim rather than a border. */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-x-0 bottom-0 h-px bg-rule-gold transition-opacity duration-500",
          solid ? "opacity-45" : "opacity-0",
        )}
      />

      <Container className="flex h-20 items-center justify-between gap-3 sm:gap-6">
        <Link
          to="/"
          className="group relative shrink-0 font-display text-[1.32rem] max-[359px]:text-[1.15rem] font-bold leading-[1.05] tracking-[0.03em] text-white"
          onClick={() => setOpen(false)}
        >
          Boss <em className="text-foil italic">Clinician</em>
          <span className="mt-1 block font-body text-[0.52rem] font-bold not-italic uppercase tracking-[0.26em] max-[359px]:hidden sm:tracking-[0.34em] text-gold/70 transition-colors duration-300 group-hover:text-gold">
            Lead. Heal. Elevate.
          </span>
        </Link>

        {/* Two category menus and two plain links: everything else is one
            click away inside a panel. The bar still starts at xl (below that,
            including a laptop browser zoomed in, the menu button carries
            everything) and the labels stay on one line. */}
        <nav className="hidden items-center gap-5 xl:flex 2xl:gap-8" aria-label="Primary">
          {nav.map((item, index) =>
            isNavMenu(item) ? (
              <NavDropdown
                key={item.label}
                menu={item}
                open={openMenu === item.label}
                onOpenChange={(next) =>
                  // A late close from menu A (its hover grace period) must not
                  // shut menu B, which has opened in the meantime.
                  setOpenMenu((current) =>
                    next ? item.label : current === item.label ? null : current,
                  )
                }
                // Only a menu sitting last in the bar can reach the right edge.
                align={index === nav.length - 1 ? "end" : "center"}
              />
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "group relative whitespace-nowrap py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] transition-colors duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold",
                    isActive ? "text-white" : "text-white/55 hover:text-white",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {item.label}
                    <span
                      aria-hidden
                      className={cn(
                        "absolute -bottom-0.5 left-0 h-px w-full origin-center bg-rule-gold transition-transform duration-500 ease-luxe",
                        isActive ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100",
                      )}
                    />
                  </>
                )}
              </NavLink>
            ),
          )}
        </nav>

        <div className="flex items-center gap-1 sm:gap-4">
          <Link to="/cart" aria-label={`Cart (${cartCount} items)`} className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gold hover:bg-white/[0.06]">
            <ShoppingCart className="size-5" />
            {cartCount > 0 && <span className="absolute right-0 top-0 rounded-full bg-gold px-1.5 text-xs font-bold text-night-deep">{cartCount}</span>}
          </Link>
          <SiteThemeToggle />
          {/* Members sign in from the marketing header, as on the source site.
              A text link, not a second button: the bar has ONE primary action,
              Work With Me. Book A Call sits in the Programs panel's footer and
              in the mobile sheet. */}
          <Link
            to={headerActions.logIn.to}
            className="hidden whitespace-nowrap py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/55 transition-colors duration-300 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold xl:inline-flex"
          >
            {headerActions.logIn.label}
          </Link>
          <div className="hidden xl:block">
            <LuxeButton to="/work-with-me" variant="foil" size="sm" className="whitespace-nowrap">
              Work With Me
            </LuxeButton>
          </div>

          <button
            type="button"
            className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-white transition-colors hover:bg-white/[0.06] xl:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="relative block h-4 w-6">
              <span
                className={cn(
                  "absolute left-0 top-0 h-px w-6 bg-gold transition-transform duration-300 ease-luxe",
                  open && "translate-y-[7px] rotate-45",
                )}
              />
              <span
                className={cn(
                  "absolute left-0 top-[7px] h-px w-6 bg-white transition-opacity duration-300",
                  open && "opacity-0",
                )}
              />
              <span
                className={cn(
                  "absolute left-0 top-[14px] h-px w-6 bg-gold transition-transform duration-300 ease-luxe",
                  open && "-translate-y-[7px] -rotate-45",
                )}
              />
            </span>
          </button>
        </div>
      </Container>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
            transition={{ duration: prefersReducedMotion ? 0.12 : 0.35, ease: [0.22, 1, 0.36, 1] }}
            // The sheet's background must be FULLY opaque. At 95% alpha the
            // hero headline behind it stayed plainly legible through the nav
            // items: on a near-black surface the eye is dark-adapted, so a 5%
            // leak of near-white text is a ~19/255 ghost against a 6/255 field
            // — obvious, where the same leak on a light theme would vanish.
            className="absolute inset-x-0 top-full max-h-[calc(100dvh-5rem)] overflow-y-auto border-t border-white/[0.07] bg-night-deep xl:hidden"
          >
            <Container as="nav" aria-label="Mobile" className="flex flex-col gap-1 py-6">
              {nav.map((item) =>
                isNavMenu(item) ? (
                  <MobileNavGroup
                    key={item.label}
                    menu={item}
                    expanded={mobileSection === item.label}
                    onToggle={() =>
                      setMobileSection((current) => (current === item.label ? null : item.label))
                    }
                    onNavigate={() => setOpen(false)}
                  />
                ) : (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        "rounded-xl px-4 py-3.5 font-display text-lg text-white/70 transition-colors hover:bg-white/[0.05] hover:text-white",
                        isActive && "bg-white/[0.05] text-white",
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                ),
              )}
              <div aria-hidden className="rule-faint my-4" />
              <LuxeButton
                to="/work-with-me"
                variant="foil"
                size="md"
                className="w-full"
                onClick={() => setOpen(false)}
              >
                Work With Me
              </LuxeButton>
              <LuxeButton
                href={headerActions.bookACall.href}
                target="_blank"
                variant="glass"
                size="md"
                className="mt-3 w-full"
                onClick={() => setOpen(false)}
              >
                {headerActions.bookACall.label}
              </LuxeButton>
              <LuxeButton
                to={headerActions.logIn.to}
                variant="outline"
                size="md"
                className="mt-3 w-full"
                onClick={() => setOpen(false)}
              >
                {headerActions.logIn.label}
              </LuxeButton>
            </Container>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

interface MobileNavGroupProps {
  menu: NavMenu;
  /** Owned by the header: opening one section closes the other. */
  expanded: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}

/**
 * A header menu as an accordion section (there is no hover on touch). The
 * panel's footer links are not repeated here: Work With Me and Book A Call are
 * the two buttons at the bottom of the sheet.
 */
function MobileNavGroup({ menu, expanded, onToggle, onNavigate }: MobileNavGroupProps) {
  const prefersReducedMotion = useReducedMotion();
  const { pathname } = useLocation();
  const active = isMenuActive(menu, pathname);
  const panelId = `mobile-nav-${menu.label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className={cn(
          "flex min-h-[44px] w-full items-center justify-between rounded-xl px-4 py-3.5 font-display text-lg text-white/70 transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gold",
          (expanded || active) && "text-white",
        )}
      >
        {menu.label}
        <span
          aria-hidden
          className={cn(
            "text-[0.7rem] leading-none text-gold transition-transform duration-300 ease-luxe",
            expanded && "rotate-180",
          )}
        >
          ▾
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.ul
            id={panelId}
            aria-label={menu.label}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{
              duration: prefersReducedMotion ? 0 : 0.28,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="overflow-hidden pl-2"
          >
            {menu.items.map((item) => {
              const current = pathname === item.to;
              return (
                <li key={item.label}>
                  <Link
                    to={item.to}
                    onClick={onNavigate}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex min-h-[44px] flex-col justify-center gap-0.5 rounded-xl px-4 py-2.5 transition-colors hover:bg-ink/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gold",
                      current && "bg-ink/[0.05]",
                    )}
                  >
                    <span className={cn("text-[0.95rem] font-medium", current ? "text-gold" : "text-ink")}>
                      {item.label}
                    </span>
                    <span className="text-[0.8rem] leading-snug text-orchid-dim">
                      {item.description}
                    </span>
                  </Link>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
