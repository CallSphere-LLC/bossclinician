import { describe, it, expect } from "vitest";
import { composeDocument } from "./renderer";

/**
 * `String.replace` reads `$&`, `` $` ``, `$'` and `$$` inside a *replacement
 * string* as substitution patterns, and both of this module's replacements
 * carry page content: the head block embeds the JSON the browser hydrates from,
 * and the app block is the rendered post itself.
 *
 * The failure was not subtle. A blog excerpt containing `$'` expanded to
 * everything in index.html after the marker, so the JSON payload block was
 * closed by the shell's own `</script>` and the rest of the document was
 * emitted a second time — the module script loaded twice and hydration failed.
 */
const SHELL = `<html><head><!--bc-head--></head><body><div id="root"><!--bc-app--></div><script src="/app.js"></script></body></html>`;

describe("composeDocument", () => {
  it("inserts both blocks verbatim", () => {
    const html = composeDocument(SHELL, "<title>Hi</title>", "<h1>Hi</h1>");
    expect(html).toContain("<head><title>Hi</title></head>");
    expect(html).toContain('<div id="root"><h1>Hi</h1></div>');
  });

  it("does not expand $' in the payload into the rest of the shell", () => {
    const head = `<script type="application/json">{"excerpt":"pay $' now"}</script>`;
    const html = composeDocument(SHELL, head, "<h1>Post</h1>");

    expect(html).toContain(`{"excerpt":"pay $' now"}`);
    // One script tag from the shell, not a second copy of everything after the marker.
    expect(html.match(/<script src="\/app\.js">/g)).toHaveLength(1);
    expect(html.match(/<div id="root">/g)).toHaveLength(1);
  });

  it("leaves $&, $` and $$ alone in both blocks", () => {
    const html = composeDocument(SHELL, "<meta content=\"$& $`\">", "<p>$$5 off</p>");
    expect(html).toContain('<meta content="$& $`">');
    expect(html).toContain("<p>$$5 off</p>");
    expect(html).not.toContain("<!--bc-head-->");
    expect(html).not.toContain("<!--bc-app-->");
  });
});
