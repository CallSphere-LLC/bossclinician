import { Link } from "react-router";
import { Container } from "@/components/ui/Container";
import { Aurora } from "@/components/luxe/Aurora";
import { footer } from "@/content/site";
import { SubscribeForm } from "@/components/forms/SubscribeForm";
import { cn } from "@/lib/cn";

const columnHeading =
  "mb-6 text-[0.6rem] font-bold uppercase tracking-[0.26em] text-gold/70";
/**
 * Footer links measured 18px tall — a stack of sub-thumb-sized targets is the
 * worst tap area on the page. The padding lives on the link (not as negative
 * margin on a tight list): pulling the hit box outward with `-my-*` would make
 * adjacent links' tap areas overlap, which trades a small target for a
 * mis-targeted one. Padding plus a smaller `space-y` gets ~38px of target with
 * a clean 4px gutter between them.
 */
const columnLink =
  "block py-2.5 text-sm text-white/45 transition-colors duration-300 hover:text-gold";

export function Footer() {
  return (
    <footer className="relative isolate overflow-hidden bg-night-deep">
      {/* Foil trim along the top edge, then a low-intensity light field. The
          footer is the page's last frame — flat black here undoes the depth
          every section above it just built. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-rule-gold opacity-40" />
      <Aurora tone="plum" intensity={0.35} />

      <Container className="relative z-[1] grid gap-12 py-14 sm:py-16 lg:gap-14 lg:py-24 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <p className="font-display text-2xl font-bold leading-[1.05] text-white">
            Boss <em className="text-foil italic">Clinician</em>
          </p>
          <p className="mt-2 text-[0.62rem] font-bold uppercase tracking-[0.3em] text-gold/75">
            {footer.brandTagline}
          </p>
          <p className="mt-6 max-w-sm text-sm font-light leading-[1.8] text-white/40">
            {footer.tagline}
          </p>
          <div className="mt-8 max-w-sm">
            <SubscribeForm source="footer" dark />
          </div>
        </div>

        <div>
          <h3 className={columnHeading}>Explore</h3>
          <ul className="space-y-1">
            {footer.exploreLinks.map((item) => (
              <li key={item.label}>
                <Link to={item.to} className={columnLink}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className={columnHeading}>Free Resources</h3>
          <ul className="space-y-1">
            {footer.resourceLinks.map((item) => (
              <li key={item.label}>
                <Link to={item.to} className={columnLink}>
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <a
                href={footer.bookACall}
                target="_blank"
                rel="noopener noreferrer"
                className={columnLink}
              >
                Book a Free Call
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h3 className={columnHeading}>Connect</h3>
          <ul className="space-y-1">
            <li>
              <a href={`mailto:${footer.contactEmail}`} className={cn(columnLink, "break-all")}>
                {footer.contactEmail}
              </a>
            </li>
            <li>
              <a
                href={footer.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className={columnLink}
              >
                Instagram {footer.instagramHandle}
              </a>
            </li>
            <li>
              <a
                href={footer.facebook}
                target="_blank"
                rel="noopener noreferrer"
                className={columnLink}
              >
                Facebook
              </a>
            </li>
            <li>
              <a
                href={footer.threads}
                target="_blank"
                rel="noopener noreferrer"
                className={columnLink}
              >
                Threads
              </a>
            </li>
            <li>
              <a
                href={footer.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className={columnLink}
              >
                LinkedIn
              </a>
            </li>
            <li>
              <a
                href={footer.tiktok}
                target="_blank"
                rel="noopener noreferrer"
                className={columnLink}
              >
                TikTok {footer.tiktokHandle}
              </a>
            </li>
          </ul>
        </div>
      </Container>

      <div className="relative z-[1] border-t border-white/[0.06]">
        <Container className="flex flex-col-reverse items-start justify-between gap-4 py-8 text-xs text-white/25 sm:flex-row sm:items-center">
          {/* UTC on both sides of the handoff. The page is rendered on a server
              running UTC and hydrated in the reader's own zone, so a local year
              would disagree with itself for the few hours either side of New
              Year when the two calendars have not yet met. */}
          <p>
            &copy; {new Date().getUTCFullYear()} Boss Clinician, LLC &middot; Yvette Howard, LCSW
            &middot; All Rights Reserved
          </p>
          <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
            {footer.legalLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="inline-block py-2 text-[0.78rem] text-white/30 transition-colors duration-300 hover:text-gold/80"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </Container>
      </div>
    </footer>
  );
}
