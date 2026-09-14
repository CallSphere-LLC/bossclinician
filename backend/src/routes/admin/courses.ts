import { coursesRepo } from "../../db/repos";
import { courseSchema, courseUpdateSchema } from "../../validation/schemas";
import { buildAdminCrudRouter } from "./crudFactory";

export const adminCoursesRouter = buildAdminCrudRouter({ ...coursesRepo, list: (opts) => coursesRepo.list({ ...opts, where: "NOT EXISTS (SELECT 1 FROM products p WHERE p.legacy_course_id=courses.id AND p.kind='download')" }) }, courseSchema, courseUpdateSchema);
