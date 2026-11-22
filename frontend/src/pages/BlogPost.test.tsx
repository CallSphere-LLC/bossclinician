import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Route, Routes, StaticRouter } from "react-router";
import BlogPost from "./BlogPost";
import { blogPosts, findBlogPostBySlug } from "@/content/blog";
import { SsrProvider } from "@/ssr/context";
import { ssrKeys } from "@/ssr/keys";

/**
 * An article page (sheet row 245, section 13): the closing card names a next
 * step that fits the article rather than one generic application button, and
 * the archive carries no expired live-event invitations.
 */
function render(slug: string): string {
  return renderToStaticMarkup(
    <SsrProvider
      runtime={{
        payload: {
          origin: "https://example.com",
          indexable: true,
          data: { [ssrKeys.blogPost(slug)]: findBlogPostBySlug(slug) ?? null },
        },
        headSink: [],
      }}
    >
      <StaticRouter location={`/blog/${slug}`}>
        <Routes>
          <Route path="/blog/:slug" element={<BlogPost />} />
        </Routes>
      </StaticRouter>
    </SsrProvider>,
  );
}

describe("the article's closing next step", () => {
  it("sends a starting-out article to the Practice Prep Training", () => {
    const html = render("dont-let-fear-delay-your-private-practice");
    expect(html).toContain("Watch the Free Practice Prep Training");
    expect(html).toContain('href="/practicepreptraining"');
    expect(html).not.toContain("Apply to Work With Yvette");
  });

  it("sends the caseload article to the Freedom Masterclass", () => {
    const html = render("how-to-stop-seeing-25-clients-a-week-and-still-hit-your-income-goals");
    expect(html).toContain("Watch the Free Freedom Masterclass");
    expect(html).toContain('href="/freedom-masterclass"');
  });

  it("sends any other article to the practice quiz", () => {
    const html = render("what-auditors-look-for-therapist-notes");
    expect(html).toContain("Find My Next Step");
    expect(html).toContain('href="/practice-quiz"');
    expect(html).not.toContain("Apply to Work With Yvette");
  });
});

describe("the bundled archive", () => {
  const all = blogPosts.map((post) => `${post.title}\n${post.excerpt}\n${post.bodyMd}`).join("\n");

  it("no longer invites readers to expired live events", () => {
    expect(all).not.toContain("Register before seats close");
    expect(all).not.toContain("/doc-registration");
    expect(all).not.toContain("Registration Closes September 25");
    expect(all).not.toContain("I will be teaching inside **Audit Proof Your Practice** on January 30");
    expect(all).not.toContain("hosting Audit Proof Your Practice on January 30");
  });

  it("routes the audit articles to the on-demand training", () => {
    for (const slug of [
      "peace-of-mind-for-therapists-audit-preparedness",
      "what-auditors-look-for-therapist-notes",
      "clinical-notes-vs-audit-ready-notes",
      "audit-ready-documentation-private-practice",
    ]) {
      const body = findBlogPostBySlug(slug)?.bodyMd ?? "";
      expect(body).toContain("(/courses/audit-proof-your-practice-on-demand)");
      expect(body).not.toContain("/courses/private-practice-protection-pack");
    }
  });

  it("uses the confirmed course name and the current caseload line", () => {
    expect(findBlogPostBySlug("money-guilt-therapists-charging-fees")?.bodyMd).toContain(
      "[Ramp-Up Rate Formula](/courses/ramp-up-rate-formula)",
    );
    const caseload = findBlogPostBySlug("how-to-stop-seeing-25-clients-a-week-and-still-hit-your-income-goals")?.bodyMd ?? "";
    expect(caseload).toContain("I currently maintain a small clinical caseload to keep my clinical skills current.");
    // The stray escaped code fence (\`\`\`) that printed as visible backticks.
    expect(caseload).not.toContain("`");
    expect(caseload).not.toContain("bi-weekly, three days a week");
  });
});
