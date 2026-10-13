import { describe, expect, it } from "vitest";
import { previewFileViewPath, previewPath } from "./coursePreview";

/**
 * The preview answers in the member API's shapes, and those carry ready-made
 * links. Left as the member's `/library/...` they would walk an administrator
 * out of the admin and onto the member site's sign-in page, so every one of them
 * is rebuilt with this — and it has to name the routes the admin app mounts.
 */
describe("previewPath", () => {
  it("addresses the course preview by course id", () => {
    expect(previewPath(12)).toBe("/admin/courses/12/preview");
  });

  it("addresses a lesson inside it by slug", () => {
    expect(previewPath(12, "welcome")).toBe("/admin/courses/12/preview/lessons/welcome");
  });
});

/**
 * The viewer's address has to sit under /api/admin/: that is the only API path
 * the admin host proxies, and anything else is a 302 to the public host that the
 * admin CSP will not let fetch follow.
 */
describe("previewFileViewPath", () => {
  it("is a same-origin admin API path", () => {
    expect(previewFileViewPath(12, 7)).toBe("/api/admin/courses/12/preview/files/7/view");
  });
});
