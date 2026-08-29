import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import App from "./App";
import { renderHead, resolveHead } from "./seo/head";
import type { HeadDescriptor } from "./seo/types";
import { SSR_PAYLOAD_ID, SsrProvider, type SsrPayload } from "./ssr/context";
import { ssrKeys } from "./ssr/keys";
import { preloadPublicRoute } from "./ssr/preload";

/**
 * The server half of the app.
 *
 * Built as a self-contained CommonJS bundle (see vite.config.ts) and required
 * by the API process, which is the only part of the system that can read the
 * database directly. Nothing in here opens a connection or knows a table name:
 * it is handed the rows a route needs and turns them into a document.
 */

export interface RenderResult {
  /** Markup for `<head>` — title, meta, canonical, JSON-LD. */
  head: string;
  /** The data block carrying the loader results the browser hydrates from. */
  bootstrap: string;
  /** Markup for `<div id="root">`. */
  html: string;
  /**
   * What the page decided it is. A "not found" panel served as HTTP 200 is how
   * a dead URL stays in the index, so the page says so and the route obeys.
   */
  status: number;
}

export async function render(url: string, payload: SsrPayload): Promise<RenderResult> {
  const [pathname = "/"] = url.split("?");
  await preloadPublicRoute(pathname);

  // Per request, never module-level: two concurrent renders must not be able to
  // read each other's head tags.
  const headSink: HeadDescriptor[] = [];

  const html = renderToString(
    <StrictMode>
      <SsrProvider runtime={{ payload, headSink }}>
        <StaticRouter location={url}>
          <App />
        </StaticRouter>
      </SsrProvider>
    </StrictMode>,
  );

  // Last wins. A page that renders a "course not found" branch pushes its own
  // descriptor after the one the route started with, and that is the one true
  // of what is actually on screen.
  const descriptor = headSink[headSink.length - 1];

  const head = renderHead(
    resolveHead(descriptor, { origin: payload.origin, url, indexable: payload.indexable }),
  );

  return {
    head,
    bootstrap: `<script type="application/json" id="${SSR_PAYLOAD_ID}">${serialize(payload)}</script>`,
    html,
    status: descriptor?.httpStatus ?? 200,
  };
}

/**
 * JSON safe to embed in a `<script type="application/json">` data block.
 *
 * A data block rather than an assignment because the site is served under a
 * `script-src 'self'` Content-Security-Policy: nothing inline is allowed to
 * execute, and a payload that has to run is a payload that needs a nonce
 * threaded through nginx. Nothing here is executed, so nothing needs one.
 *
 * The HTML tokenizer still sees the block before any JSON parser does, so a
 * `</script>` inside a blog excerpt would close it early and spill the rest of
 * the payload into the document as text.
 */
function serialize(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export { ssrKeys };
export type { SsrPayload };
