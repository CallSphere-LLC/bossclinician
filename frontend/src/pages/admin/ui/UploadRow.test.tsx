import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { UploadItem } from "@/lib/uploads/manager";
import { UploadRow } from "./UploadRow";

function item(status: UploadItem["status"]): UploadItem {
  return {
    id: "u1",
    fileName: "lesson.mp4",
    sizeBytes: 1000,
    loaded: 400,
    visibility: "protected",
    scope: "test",
    status,
    hasFile: true,
    attempts: 0,
    startedAt: 0,
  };
}

/**
 * `uploadManager.resume()` returns early for anything it still counts as
 * active — offline and retrying included — so a Resume button on those rows
 * was a button that did nothing when pressed.
 */
describe("UploadRow", () => {
  it("offers Resume on a paused upload", () => {
    expect(renderToStaticMarkup(<UploadRow item={item("paused")} />)).toContain(
      "Resume lesson.mp4",
    );
  });

  it("does not offer a Resume that cannot work while offline or retrying", () => {
    for (const status of ["offline", "retrying"] as const) {
      const html = renderToStaticMarkup(<UploadRow item={item(status)} />);
      expect(html).not.toContain("Resume lesson.mp4");
      // Stopping it for good still works from these states.
      expect(html).toContain("Stop uploading lesson.mp4");
    }
  });
});
