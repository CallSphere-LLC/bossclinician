import { describe, it, expect } from "vitest";
import { toPublicTestimonial } from "./testimonials";
import { testimonialSchema, testimonialUpdateSchema } from "../../validation/schemas";
import type { Testimonial } from "../../types";

const row: Testimonial = {
  id: 1,
  name: "Jane",
  credential: "LCSW",
  quote: "Great.",
  practice: "Calm Minds",
  image: "/uploads/jane.jpg",
  sort: 0,
  published: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/**
 * The cards draw the avatar from `photo`; the table only has `image`. Returning
 * the raw row meant an uploaded headshot never showed on the site.
 */
describe("toPublicTestimonial", () => {
  it("exposes the saved image as the card's photo", () => {
    expect(toPublicTestimonial(row).photo).toBe("/uploads/jane.jpg");
  });

  it("gives a row with no picture an empty photo, so the card shows its monogram", () => {
    expect(toPublicTestimonial({ ...row, image: null }).photo).toBe("");
  });

  it("keeps every other field, practice included", () => {
    expect(toPublicTestimonial(row)).toMatchObject({ ...row, practice: "Calm Minds" });
  });
});

describe("testimonialSchema", () => {
  it("keeps practice, which every caller of the shared schema used to drop", () => {
    expect(testimonialSchema.parse({ name: "Jane", practice: "Calm Minds" }).practice).toBe("Calm Minds");
    expect(testimonialUpdateSchema.parse({ practice: null })).toEqual({ practice: null });
    expect(testimonialSchema.parse({ name: "Jane" })).not.toHaveProperty("practice");
  });
});
