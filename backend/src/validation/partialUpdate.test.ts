import { describe, expect, it } from "vitest";
import { z } from "zod";
import { partialUpdate } from "./partialUpdate";
import { blogSchema, blogUpdateSchema } from "./schemas";

/**
 * zod 4's `.partial()` fills in a field's `.default()` when the key is absent,
 * which turns every edit into a reset of the fields it didn't mention. These pin
 * the zod 3 meaning the update routes were written against.
 */
describe("partialUpdate", () => {
  const schema = z.object({
    title: z.string().min(1),
    published: z.boolean().default(false),
    offerId: z.number().int().nullable().default(null),
    tags: z.array(z.string()).default([]),
  });

  it("leaves out every field the edit left out", () => {
    expect(partialUpdate(schema).parse({ title: "Renamed" })).toEqual({ title: "Renamed" });
    expect(partialUpdate(schema).parse({})).toEqual({});
  });

  it("still validates the fields that were sent", () => {
    expect(partialUpdate(schema).safeParse({ title: "" }).success).toBe(false);
    expect(partialUpdate(schema).safeParse({ published: "yes" }).success).toBe(false);
  });

  it("keeps a null that was sent to clear a nullable field", () => {
    expect(partialUpdate(schema).parse({ offerId: null })).toEqual({ offerId: null });
  });

  it("leaves the create schema's defaults where they were", () => {
    partialUpdate(schema);
    expect(schema.parse({ title: "New" })).toEqual({ title: "New", published: false, offerId: null, tags: [] });
  });

  it("keeps a strict schema strict", () => {
    expect(partialUpdate(schema.strict()).safeParse({ nope: 1 }).success).toBe(false);
  });

  it("is what the content routes use: a rename does not unpublish a post", () => {
    expect(blogSchema.parse({ slug: "a", title: "A" }).published).toBe(false);
    expect(blogUpdateSchema.parse({ title: "Renamed" })).toEqual({ title: "Renamed" });
  });
});
