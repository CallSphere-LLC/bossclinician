import type { Dispatch, SetStateAction } from "react";
import type { LessonResponse, LibraryProduct } from "@/lib/libraryApi";
import type { PlayerApi } from "./playerSource";

/**
 * Refresh server-calculated gates after completion. Reads are independent: a
 * failed neighbour request must not leave a successful outline refresh stale.
 * The effect's cleanup cancels application after navigation/unmount.
 */
export function refreshCourseNavigation(
  api: Pick<PlayerApi, "getProduct" | "getLesson">,
  productSlug: string,
  lessonSlug: string,
  setProduct: Dispatch<SetStateAction<LibraryProduct | null>>,
  setLessonData: Dispatch<SetStateAction<LessonResponse | null>>,
): () => void {
  let cancelled = false;
  void api.getProduct(productSlug).then((fresh) => {
    if (!cancelled) setProduct(fresh);
  }).catch(() => undefined);
  void api.getLesson(productSlug, lessonSlug).then((fresh) => {
    if (cancelled) return;
    setLessonData((current) =>
      current && current.lesson.id === fresh.lesson.id
        ? { ...current, prev: fresh.prev, next: fresh.next }
        : current,
    );
  }).catch(() => undefined);
  return () => { cancelled = true; };
}
