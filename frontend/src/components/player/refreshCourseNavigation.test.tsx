import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { Dispatch, SetStateAction } from "react";
import type { LessonResponse, LibraryProduct, OutlineLesson } from "@/lib/libraryApi";
import { CourseOutline } from "./CourseOutline";
import { refreshCourseNavigation } from "./refreshCourseNavigation";

function state<T>(initial: T) {
  let value = initial;
  const set: Dispatch<SetStateAction<T>> = (next) => {
    value = typeof next === "function" ? (next as (value: T) => T)(value) : next;
  };
  return { get: () => value, set };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const lesson = (id: number, title: string): OutlineLesson => ({
  id, slug: `qa-${id}`, title, contentType: "assessment", durationMinutes: 0,
  videoDurationSeconds: 0, preview: false, unlocked: false, locked: true,
  lockReason: "previous_incomplete", unlocksAt: null,
  unlockLabel: "Finish watching (0:06 left)", completed: false, completedAt: null,
  lastPositionSeconds: 0, watchedPercent: 0, href: `/library/qa/lessons/qa-${id}`,
});
function fixture() {
  const before = {
    productId: 79, slug: "qa", title: "QA", kind: "course",
    course: { courseId: 67, modules: [
      { id: 133, title: "QA", summary: "", unlocked: true, unlocksAt: null, unlockLabel: "",
        lessons: [{ ...lesson(416, "QA video"), contentType: "video", unlocked: true, completed: true },
          lesson(417, "QA knowledge check")] },
      { id: 134, title: "Next module", summary: "", unlocked: false, unlocksAt: null,
        unlockLabel: "Finish previous module", lessons: [lesson(419, "Next phase")] },
    ] },
  } as LibraryProduct;
  const after = structuredClone(before);
  if (after.kind === "course") {
    for (const module of after.course.modules) {
      module.unlocked = true;
      module.unlockLabel = "";
      for (const item of module.lessons) {
        item.unlocked = true;
        item.locked = false;
        item.lockReason = null;
        item.unlockLabel = "";
      }
    }
  }
  const playing = {
    product: { slug: "qa", title: "QA" },
    course: { courseId: 67 },
    lesson: { id: 416, locked: false, videoUrl: "current-signed-url",
      mediaExpiresAt: "2026-10-27T12:00:00Z",
      progress: { completed: true, lastPositionSeconds: 0, watchedPercent: 0 } },
    prev: null, next: { slug: "qa-417", title: "QA knowledge check", unlocked: false },
  } as LessonResponse;
  const freshLesson = structuredClone(playing);
  freshLesson.next!.unlocked = true;
  if (!freshLesson.lesson.locked) {
    freshLesson.lesson.videoUrl = "new-signed-url";
    freshLesson.lesson.progress.lastPositionSeconds = 6;
    freshLesson.lesson.progress.watchedPercent = 100;
  }
  return { before, after, playing, freshLesson };
}
function outline(product: LibraryProduct | null) {
  if (!product || product.kind !== "course") throw new Error("Expected course");
  return renderToStaticMarkup(<MemoryRouter>
    <CourseOutline modules={product.course.modules} productSlug="qa" />
  </MemoryRouter>);
}
describe("completion navigation refresh", () => {
  it("replaces stale sidebar gates with server links for the next lesson and module without restarting playback", async () => {
    const { before, after, playing, freshLesson } = fixture();
    const product = state<LibraryProduct | null>(before);
    const current = state<LessonResponse | null>(playing);
    expect(outline(product.get())).toContain("Finish watching (0:06 left)");
    expect(outline(product.get())).not.toContain('href="/library/qa/lessons/qa-417"');
    const api = { getProduct: vi.fn().mockResolvedValue(after), getLesson: vi.fn().mockResolvedValue(freshLesson) };
    refreshCourseNavigation(api, "qa", "qa-416", product.set, current.set);
    await flush();
    const html = outline(product.get());
    expect(html).toContain('href="/library/qa/lessons/qa-417"');
    expect(html).toContain('href="/library/qa/lessons/qa-419"');
    expect(html).not.toContain("Finish watching");
    expect(html).not.toContain("Finish previous module");
    expect(current.get()!.next!.unlocked).toBe(true);
    expect(current.get()!.lesson).toBe(playing.lesson);
    expect(api.getProduct).toHaveBeenCalledExactlyOnceWith("qa");
    expect(api.getLesson).toHaveBeenCalledExactlyOnceWith("qa", "qa-416");
  });

  it("refreshes the outline even if Next was already unlocked", async () => {
    const { before, after, playing, freshLesson } = fixture();
    playing.next!.unlocked = true;
    const product = state<LibraryProduct | null>(before);
    const current = state<LessonResponse | null>(playing);
    refreshCourseNavigation({ getProduct: async () => after, getLesson: async () => freshLesson },
      "qa", "qa-416", product.set, current.set);
    await flush();
    expect(outline(product.get())).toContain('href="/library/qa/lessons/qa-417"');
  });

  it("ignores late responses after navigation or unmount", async () => {
    const { before, after, playing, freshLesson } = fixture();
    const product = state<LibraryProduct | null>(before);
    const current = state<LessonResponse | null>(playing);
    const pendingProduct = deferred<LibraryProduct>();
    const pendingLesson = deferred<LessonResponse>();
    const cancel = refreshCourseNavigation({
      getProduct: () => pendingProduct.promise, getLesson: () => pendingLesson.promise,
    }, "qa", "qa-416", product.set, current.set);
    cancel();
    product.set(null);
    current.set(null);
    pendingProduct.resolve(after);
    pendingLesson.resolve(freshLesson);
    await flush();
    expect(product.get()).toBeNull();
    expect(current.get()).toBeNull();
  });

  it.each(["product", "lesson"] as const)("keeps the other refresh if the %s read fails", async (failed) => {
    const { before, after, playing, freshLesson } = fixture();
    const product = state<LibraryProduct | null>(before);
    const current = state<LessonResponse | null>(playing);
    refreshCourseNavigation({
      getProduct: async () => { if (failed === "product") throw new Error("offline"); return after; },
      getLesson: async () => { if (failed === "lesson") throw new Error("offline"); return freshLesson; },
    }, "qa", "qa-416", product.set, current.set);
    await flush();
    expect(product.get()).toBe(failed === "product" ? before : after);
    expect(current.get()!.next!.unlocked).toBe(failed !== "lesson");
    expect(current.get()!.lesson).toBe(playing.lesson);
  });
});
