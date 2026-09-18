import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { useEffect } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { ChatWidget } from "@/components/ChatWidget";
import { cn } from "@/lib/cn";

/**
 * Every public route now renders in the Obsidian Luxe dark theme.
 *
 * `theme-luxe` swaps the semantic colour variables (see index.css), so pages
 * still written against the original `text-ink` / `bg-cream` / `border-hairline`
 * tokens re-theme without being rewritten; `grain-overlay` and the dark
 * scrollbars come along with it.
 */
export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();

  // Only the home page opens with a full-bleed hero that owns the top of the
  // viewport, so only there can the header start transparent and materialise on
  // scroll. Interior pages begin with their own header band, and a transparent
  // bar over that would leave the nav floating on an arbitrary background.
  const transparentHeader = location.pathname === "/";

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [location.pathname]);

  // The grain overlay is `position: fixed`, so it must be owned by the page
  // shell rather than any one section — otherwise it would scroll with content
  // and tile visibly at section boundaries.
  return (
    <div
      className="theme-luxe grain-overlay flex min-h-screen flex-col bg-night-deep"
    >
      <a
        href="#main-content"
        className={cn(
          "sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]",
          "focus:rounded-full focus:bg-gold focus:px-5 focus:py-2.5",
          "focus:text-sm focus:font-semibold focus:text-[#06040b]",
        )}
      >
        Skip to main content
      </a>
      <Header transparentAtTop={transparentHeader} />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <Footer />
      <ChatWidget />
    </div>
  );
}
