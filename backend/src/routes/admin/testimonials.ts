import { z } from "zod";
import { testimonialsRepo } from "../../db/repos";
import { testimonialSchema } from "../../validation/schemas";
import { partialUpdate } from "../../validation/partialUpdate";
import { buildAdminCrudRouter } from "./crudFactory";

/**
 * The shared schema predates the `practice` column, and zod drops keys it
 * doesn't name — so "Their practice or business" in the admin was accepted,
 * thrown away, and came back blank on every save. Nullable because rows
 * written before the column existed hold NULL, and the edit form sends back
 * whatever the row had.
 */
export const adminTestimonialSchema = testimonialSchema.extend({
  practice: z.string().max(200).nullable().optional(),
});
export const adminTestimonialUpdateSchema = partialUpdate(adminTestimonialSchema);

export const adminTestimonialsRouter = buildAdminCrudRouter(
  testimonialsRepo,
  adminTestimonialSchema,
  adminTestimonialUpdateSchema
);
