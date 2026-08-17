import { coursesRepo } from "../../db/repos";
import { courseSchema, courseUpdateSchema } from "../../validation/schemas";
import { buildAdminCrudRouter } from "./crudFactory";

export const adminCoursesRouter = buildAdminCrudRouter(coursesRepo, courseSchema, courseUpdateSchema);
