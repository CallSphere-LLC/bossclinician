import { testimonialsRepo } from "../../db/repos";
import { testimonialSchema, testimonialUpdateSchema } from "../../validation/schemas";
import { buildAdminCrudRouter } from "./crudFactory";

export const adminTestimonialsRouter = buildAdminCrudRouter(
  testimonialsRepo,
  testimonialSchema,
  testimonialUpdateSchema
);
