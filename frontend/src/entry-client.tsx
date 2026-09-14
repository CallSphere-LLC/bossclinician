import { initializeSiteTheme } from "./lib/siteTheme";
import { clearLegacyAdminToken } from "./lib/adminTransport";
import { StrictMode, type ReactNode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { enableEntrances } from "./hooks/useEntranceMotion";
import { SSR_PAYLOAD_ID, SsrProvider, type SsrPayload, type SsrRuntime } from "./ssr/context";
import { preloadPublicRoute } from "./ssr/preload";
import "./index.css";

clearLegacyAdminToken();
initializeSiteTheme();

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

/** The loader results the document was rendered from, where there are any. */
function serverPayload(): SsrPayload | null {
  const node = document.getElementById(SSR_PAYLOAD_ID);
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent) as SsrPayload;
  } catch {
    // Unparseable means the document cannot be trusted to describe itself, so
    // the app builds the page from scratch rather than hydrating onto markup it
    // cannot reproduce.
    return null;
  }
}

function tree(runtime: SsrRuntime): ReactNode {
  return (
    <StrictMode>
      <SsrProvider runtime={runtime}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </SsrProvider>
    </StrictMode>
  );
}

const payload = serverPayload();

if (payload) {
  // The page component has to be resolved before React starts, or hydration
  // begins against the route's loading placeholder and React throws away the
  // server's markup — the article the crawler read would be rebuilt from
  // scratch, and the first paint would flicker for everyone else.
  // The `.catch` is not decoration. A browser holding a cached copy of the old
  // index.html after a deploy asks for a chunk that no longer exists; the
  // import rejects, and without this the `.then` never runs — `hydrateRoot` is
  // never called at all and the visitor is left on inert server markup where
  // no menu opens and no button does anything, with only an unhandled
  // rejection to show for it. Hydrating anyway is the lesser failure: React
  // falls back to rendering the page itself, and the worst case becomes a
  // loading state that a refresh (which fetches a current index.html) clears.
  void preloadPublicRoute(window.location.pathname)
    .catch(() => undefined)
    .then(() => {
      hydrateRoot(container, tree({ payload, headSink: null }));
    });
} else {
  // No server render to agree with: the member app and the admin boot straight
  // into the client, so their entrance animations start immediately.
  enableEntrances();
  createRoot(container).render(
    tree({
      payload: { origin: window.location.origin, indexable: true, data: {} },
      headSink: null,
    }),
  );
}
