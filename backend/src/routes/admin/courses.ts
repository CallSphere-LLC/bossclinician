import { coursesRepo } from "../../db/repos";
import { courseSchema, courseUpdateSchema } from "../../validation/schemas";
import { buildAdminCrudRouter } from "./crudFactory";
import { adminCoursePreviewRouter } from "./coursePreview";

// A course row that a download (051) or a one-to-one coaching programme (120)
// has taken over is not a course to the owner, so the list leaves it out. The
// row is kept and still opens by id: a coaching programme's lessons are edited
// at /admin/courses/:id/curriculum from its card on the Coaching page.
export const adminCoursesRouter = buildAdminCrudRouter({ ...coursesRepo, list: (opts) => coursesRepo.list({ ...opts, where: "NOT EXISTS (SELECT 1 FROM products p WHERE p.legacy_course_id=courses.id AND p.kind IN ('download','coaching'))" }) }, courseSchema, courseUpdateSchema);

// "Preview as student": read-only, admin-authenticated, in the member API's
// shapes. Two segments, so it never competes with the CRUD router's `/:id`.
adminCoursesRouter.use("/:courseId/preview", adminCoursePreviewRouter);
