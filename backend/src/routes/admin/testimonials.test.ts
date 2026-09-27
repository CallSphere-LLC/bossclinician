import { describe, it, expect } from "vitest";
import { adminTestimonialSchema, adminTestimonialUpdateSchema } from "./testimonials";

/**
 * The admin form has a "Their practice or business" box, the table has the
 * column and the repo writes it — but the schema in front of them used to drop
 * the key, so what she typed never reached the database.
 */
describe("admin testimonial schema", () => {
  it("keeps the practice on create", () => {
    const parsed = adminTestimonialSchema.parse({ name: "Jane", practice: "Calm Minds Therapy" });
    expect(parsed.practice).toBe("Calm Minds Therapy");
  });

  it("keeps the practice on edit, and accepts the NULL an older row carries", () => {
    expect(adminTestimonialUpdateSchema.parse({ practice: "Calm Minds" }).practice).toBe("Calm Minds");
    expect(adminTestimonialUpdateSchema.parse({ name: "Jane", practice: null }).practice).toBeNull();
  });

  it("still leaves an absent field absent on edit", () => {
    expect(adminTestimonialUpdateSchema.parse({ practice: "X" })).toEqual({ practice: "X" });
  });
});
