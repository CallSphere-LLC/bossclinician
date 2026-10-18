import type { ReactNode } from "react";
import { Link } from "react-router";
import { Seo } from "@/components/Seo";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { Section } from "@/components/luxe/Section";
import { openCookiePreferences } from "@/lib/consent";
import { cn } from "@/lib/cn";

/**
 * /cookie-policy — what this site stores in a visitor's browser and why.
 *
 * Written for this site (QA sheet row 96, 15 Oct 2026); her Kajabi site had no
 * cookie policy of its own. It describes what the code actually sets — the
 * cookie names come from backend/src/auth, routes/public/affiliateTracking.ts
 * and services/voice, the categories from lib/consent.ts — so a change to any
 * of those should be reflected here.
 */

const UPDATED = "October 17, 2026";
const EMAIL = "yvette@bossclinician.com";

const LINK = cn(
  "text-gold underline decoration-gold/40 underline-offset-4",
  "transition-colors duration-300 hover:text-gold-bright hover:decoration-gold",
);

interface Row {
  name: string;
  purpose: string;
  lasts: string;
}

const ESSENTIAL: Row[] = [
  {
    name: "bc_member_refresh, bc_member_active",
    purpose: "Keep you signed in to your member account and let the site know a session is open.",
    lasts: "Until you sign out, or the session expires",
  },
  {
    name: "bc_member_docs",
    purpose: "Lets your browser open the course files and documents your membership includes.",
    lasts: "While you are signed in",
  },
  {
    name: "__Host-bc_admin_session, __Host-bc_admin_refresh",
    purpose: "Sign-in for Boss Clinician staff on the admin site. Never set for visitors or members.",
    lasts: "Until sign-out, or the session expires",
  },
  {
    name: "bc_voice_visitor",
    purpose: "Keeps a conversation with the site's assistant together. Set only if you use the assistant.",
    lasts: "Up to 1 year",
  },
  {
    name: "bc_ref",
    purpose:
      "Partner referral. Set only when you arrive by following a Boss Clinician partner's link, so that partner is credited if you buy. It holds a random code, not your name or email.",
    lasts: "The partner program's referral window (usually 30 days)",
  },
  {
    name: "Browser storage (not cookies)",
    purpose:
      "Your cart, your light or dark theme, progress in quizzes and planners, and your cookie choice (bc_cookie_consent). Kept in your browser only.",
    lasts: "Until you clear it",
  },
  {
    name: "Stripe and PayPal",
    purpose:
      "On checkout pages only, our payment providers set their own cookies to process your payment and prevent fraud.",
    lasts: "Set by the provider",
  },
];

const OPTIONAL: Row[] = [
  {
    name: "Embedded content and social media",
    purpose:
      "The Instagram feed on the home page is provided by LightWidget, and a page may use a video player hosted by YouTube (privacy-enhanced mode), Vimeo, Loom or Wistia. When they load, those companies may set their own cookies and receive your IP address. Our own videos play from this site and need no permission.",
    lasts: "Set by each provider",
  },
  {
    name: "Analytics and marketing",
    purpose:
      "Measurement and advertising tools such as Google Analytics or the Meta pixel. We do not run any of these today. If we add them, they will stay off unless you allow this category.",
    lasts: "—",
  },
];

function Heading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-12 text-balance font-display text-[1.5rem] font-medium leading-snug text-white first:mt-0 sm:text-[1.75rem]">
      {children}
    </h2>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="copy-luxe mt-4 text-pretty">{children}</p>;
}

/** A table on wide screens; on a phone each row reads as a small card. */
function CookieTable({ rows, caption }: { rows: Row[]; caption: string }) {
  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-white/10">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="hidden bg-white/[0.04] sm:table-header-group">
          <tr>
            <th scope="col" className="px-4 py-3 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-gold">
              Name
            </th>
            <th scope="col" className="px-4 py-3 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-gold">
              What it does
            </th>
            <th scope="col" className="px-4 py-3 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-gold">
              How long
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="block border-t border-white/10 first:border-t-0 sm:table-row sm:first:border-t">
              <th scope="row" className="block px-4 pt-4 align-top font-semibold text-white sm:table-cell sm:py-4 [overflow-wrap:anywhere]">
                {row.name}
              </th>
              <td className="copy-luxe block px-4 pt-1.5 align-top text-pretty sm:table-cell sm:py-4">{row.purpose}</td>
              <td className="block px-4 pb-4 pt-1.5 align-top text-orchid-faint sm:table-cell sm:py-4">
                <span className="sm:hidden">How long: </span>
                {row.lasts}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CookiePolicy() {
  return (
    <>
      <Seo
        title="Cookie Policy | Boss Clinician"
        description="Which cookies and browser storage the Boss Clinician website uses, why, and how to change your choice at any time."
      />

      <LuxePageHero eyebrow="Legal" title="Cookie Policy" lede={`Last updated ${UPDATED}`} tone="gold" />

      <Section surface="base" space="md" aria-label="Cookie Policy">
        <article className="mx-auto max-w-[70ch]">
          <Heading>What cookies are</Heading>
          <P>
            Cookies are small text files a website stores in your browser. Sites also use similar
            browser storage (such as local storage) for the same purposes. This policy covers both,
            and calls them all “cookies”.
          </P>

          <Heading>How we use them</Heading>
          <P>
            We use only what the site needs to work until you choose otherwise. The first time you
            visit, a banner asks whether you also allow optional cookies. Nothing optional loads
            until you accept it, and choosing “Reject non-essential” keeps the site fully usable.
            We do not sell information collected through cookies.
          </P>

          <Heading>Essential cookies</Heading>
          <P>
            These keep you signed in, hold your cart, take payments securely and remember your
            settings. They cannot be switched off here, but you can block them in your browser,
            in which case parts of the site (signing in, checkout) will not work.
          </P>
          <CookieTable rows={ESSENTIAL} caption="Essential cookies and browser storage" />

          <Heading>Optional cookies</Heading>
          <P>Used only if you allow them in the cookie banner or in Cookie preferences.</P>
          <CookieTable rows={OPTIONAL} caption="Optional cookie categories" />

          <Heading>Other services this site uses</Heading>
          <P>
            The site’s typefaces are delivered by Google Fonts. Google Fonts does not set cookies,
            but your browser connects to Google to download the font files, which shares your IP
            address with Google. See the{" "}
            <Link to="/privacy-policy" className={LINK}>
              Privacy Policy
            </Link>{" "}
            for how we handle personal information more generally.
          </P>

          <Heading>Changing your choice</Heading>
          <P>
            You can change or withdraw your choice at any time from “Cookie preferences” at the foot
            of every page, or with the button below. You can also delete cookies or block them in
            your browser settings; your browser’s help pages explain how.
          </P>
          <LuxeButton type="button" variant="glass" size="md" onClick={openCookiePreferences} className="mt-6 min-h-[44px]">
            Open cookie preferences
          </LuxeButton>

          <Heading>Changes to this policy</Heading>
          <P>
            We will update this page when the cookies we use change, and change the date at the top.
            If we add a new optional category, the banner will ask you again.
          </P>

          <Heading>Questions</Heading>
          <P>
            Email{" "}
            <a href={`mailto:${EMAIL}`} className={LINK}>
              {EMAIL}
            </a>
            .
          </P>
        </article>
      </Section>
    </>
  );
}
