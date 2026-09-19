import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import Courses from "./Courses";
import { SsrProvider } from "@/ssr/context";
import { ssrKeys } from "@/ssr/keys";
import type { Course } from "@/types";

/**
 * The catalogue is server-rendered from whatever `/api/courses` returns.
 * `courses.features` is a JSONB column whose admin write schema types the value
 * as `unknown` (`courseSchema.features`), so nothing in the contract promises a
 * list. Reading `.length` off it happens inside `renderToString`, where it would
 * cost the whole library page rather than that one card's bullets — the course's
 * own sales page already reads the same field through `Array.isArray`.
 */
function renderCourses(items: unknown[]): string {
  return renderToStaticMarkup(
    <SsrProvider
      runtime={{
        payload: {
          origin: "https://example.com",
          indexable: true,
          data: { [ssrKeys.courses()]: items },
        },
        headSink: [],
      }}
    >
      <StaticRouter location="/courses">
        <Courses />
      </StaticRouter>
    </SsrProvider>,
  );
}

const COURSE: Course = {
  id: "fully-booked-toolkit",
  slug: "fully-booked-toolkit",
  title: "FULLY BOOKED TOOLKIT",
  subtitle: "Gets you booked.",
  description: "A toolkit.",
  priceText: "",
  image: "/images/toolkit.webp",
  url: "/courses/fully-booked-toolkit",
  features: ["One", "Two"],
  sort: 1,
  published: true,
};

describe("Courses catalogue", () => {
  it("sends every card to the course's own sales page", () => {
    const html = renderCourses([COURSE]);
    expect(html).toContain("FULLY BOOKED TOOLKIT");
    expect(html).toContain('href="/courses/fully-booked-toolkit"');
    // The bundled fallback rows used to link off-site to bossclinician.com.
    expect(html).not.toContain("bossclinician.com");
  });

  it("still renders the library when a course carries no feature list", () => {
    const html = renderCourses([
      { ...COURSE, features: null },
      { ...COURSE, id: "second", slug: "second", title: "SECOND COURSE" },
    ]);
    expect(html).toContain("FULLY BOOKED TOOLKIT");
    expect(html).toContain("SECOND COURSE");
  });
});
