import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { testimonialsRepo } from "../../db/repos";
import { Testimonial } from "../../types";

export const testimonialsRouter = Router();

/**
 * The site's cards draw the avatar from `photo`, but the table has no such
 * column — the admin's Photo picker saves into `image` (the `photo` it also
 * sends is dropped by validation). Handing the row back as-is meant an
 * uploaded headshot never reached the page. The SSR loader must return this
 * same shape, since the browser hydrates against it without refetching.
 */
export function toPublicTestimonial(row: Testimonial): Testimonial & { photo: string } {
  return { ...row, photo: row.image ?? "" };
}

export async function listPublicTestimonials(): Promise<Array<Testimonial & { photo: string }>> {
  const rows = await testimonialsRepo.list({ where: "published = true" });
  return rows.map(toPublicTestimonial);
}

testimonialsRouter.get(
  "/testimonials",
  asyncHandler(async (_req, res) => {
    res.json(await listPublicTestimonials());
  })
);
