import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import Boardroom from "./Boardroom";
import { boardroom } from "@/content/boardroom";
import { SsrProvider } from "@/ssr/context";
import type { HeadDescriptor } from "@/seo/types";

/**
 * /boardroom is server-rendered, and this suite runs in Node with no `window`
 * and no `document` — so rendering it here at all is the proof that nothing on
 * the page reaches for the browser while it renders. The rest pins what the
 * server's HTML must already say before a line of script runs.
 */
function render(): { html: string; head: HeadDescriptor[] } {
  const head: HeadDescriptor[] = [];
  const html = renderToString(
    <SsrProvider
      runtime={{ payload: { origin: "https://example.com", indexable: true, data: {} }, headSink: head }}
    >
      <StaticRouter location="/boardroom">
        <Boardroom />
      </StaticRouter>
    </SsrProvider>,
  );
  return { html, head };
}

describe("the Boardroom page, server-rendered", () => {
  const { html, head } = render();

  it("describes itself with her title and description", () => {
    expect(head.at(-1)?.title).toBe("The Boardroom | Boss Clinician");
    expect(head.at(-1)?.description).toBe(boardroom.seo.description);
  });

  it("carries the three in-page destinations her bar linked to", () => {
    for (const id of ["inside", "fit", "apply"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`href="#${id}"`);
    }
  });

  it("says everything before any script runs, and hides none of it", () => {
    expect(html).toContain("$500,000.");
    expect(html).toContain("The Boardroom is where we work on the business underneath the revenue.");
    expect(html).toContain("Only Six Seats.");
    // The reveal is armed in the browser, never in the server's markup.
    expect(html).not.toContain("br-reveal-armed");
    expect(html).not.toContain("br-visible");
  });

  it("sends the Lounge link to this site's own page", () => {
    expect(html).toContain('href="/lounge"');
    expect(html).not.toContain("bossclinician.com/lounge");
  });

  it("opens the application on its first step, with no preview notice", () => {
    expect(html).toContain('class="br-step is-active"');
    expect(html.match(/class="br-step is-active"/g)).toHaveLength(1);
    expect(html).not.toMatch(/form is a preview/i);
  });
});

/**
 * The page draws its own version of the questions, and the server checks every
 * reply against the stored form migration 074 creates. If the two lists drift,
 * a question the page does not ask becomes a required answer nobody can give.
 */
describe("the Boardroom application and the form it posts to", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migration = readFileSync(
    path.resolve(here, "../../../backend/src/db/migrations/074_boardroom_page.sql"),
    "utf8",
  );
  const stored = JSON.parse(migration.split("$fields$")[1]) as {
    key: string;
    label: string;
    type: string;
    required: boolean;
    options?: string[];
    placeholder?: string;
    helpText?: string;
  }[];
  const asked = boardroom.application.steps.flatMap((step) => step.fields);

  it("asks the same questions in the same order", () => {
    expect(asked.map((field) => field.key)).toEqual(stored.map((field) => field.key));
  });

  it("agrees on every label, type, choice and required flag", () => {
    asked.forEach((field, index) => {
      const row = stored[index];
      expect(
        {
          label: field.label,
          type: field.type,
          required: field.required,
          options: field.options,
          placeholder: field.placeholder,
          hint: field.hint,
        },
        field.key,
      ).toEqual({
        label: row.label,
        type: row.type,
        required: row.required,
        options: row.options,
        placeholder: row.placeholder,
        hint: row.helpText,
      });
    });
  });

  it("thanks the applicant in the same words the form is created with", () => {
    expect(migration.split("$msg$")[1]).toBe(boardroom.application.success.fallback);
  });
});
