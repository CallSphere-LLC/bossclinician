import { useMemo, useState } from "react";
import { useParams } from "react-router";
import CoursePlayer from "@/pages/member/CoursePlayer";
import { PlayerSourceProvider, type PlayerSource } from "@/components/player/playerSource";
import {
  courseEditorPath,
  coursePreviewPath,
  createCoursePreviewApi,
} from "@/lib/coursePreviewApi";

/**
 * "Preview as student" — the member course player, fed by the admin.
 *
 * This page draws nothing of its own. It mounts the same `CoursePlayer` a
 * student gets, inside a `PlayerSourceProvider` that swaps where the player
 * reads from (admin-authenticated, read-only endpoints) and where its links
 * point (back into this preview, not out to `/library`). Nobody is impersonated
 * and no member session exists; the writes a student could make are answered in
 * the browser and never sent.
 *
 * Rendered outside AdminLayout on purpose: the console chrome and its theme
 * would be the first thing to make this stop looking like the student's page.
 */
export default function CoursePreview() {
  const params = useParams();
  const courseId = params.id ?? "";
  const [courseDraft, setCourseDraft] = useState(false);

  // Stable for the life of the page: the player's effects depend on `api`, and
  // a new object each render would refetch the course on every keystroke.
  const data = useMemo(
    () => createCoursePreviewApi(courseId, (product) => setCourseDraft(product.courseDraft === true)),
    [courseId],
  );

  const source = useMemo<PlayerSource>(
    () => ({
      preview: { editorPath: courseEditorPath(courseId), courseDraft },
      api: data.api,
      quiz: data.quiz,
      // The player's "product slug" is the course id here, already in the path.
      productPath: () => coursePreviewPath(courseId),
      lessonPath: (_productSlug, lessonSlug) => coursePreviewPath(courseId, lessonSlug),
    }),
    [courseId, courseDraft, data],
  );

  return (
    <PlayerSourceProvider value={source}>
      <CoursePlayer productSlug={courseId} lessonSlug={params.lessonSlug} />
    </PlayerSourceProvider>
  );
}
