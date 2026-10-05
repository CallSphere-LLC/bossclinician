import { coursesRepo } from "../../db/repos";
import { courseSchema, courseUpdateSchema } from "../../validation/schemas";
import { buildAdminCrudRouter } from "./crudFactory";
import { adminCoursePreviewRouter } from "./coursePreview";

export const adminCoursesRouter = buildAdminCrudRouter({ ...coursesRepo, list: (opts) => coursesRepo.list({ ...opts, where: "NOT EXISTS (SELECT 1 FROM products p WHERE p.legacy_course_id=courses.id AND p.kind='download')" }) }, courseSchema, courseUpdateSchema);

// "Preview as student": read-only, admin-authenticated, in the member API's
// shapes. Two segments, so it never competes with the CRUD router's `/:id`.
adminCoursesRouter.use("/:courseId/preview", adminCoursePreviewRouter);
