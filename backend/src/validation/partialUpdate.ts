import { z } from "zod";

type WithoutDefault<T extends z.core.SomeType> =
  T extends z.ZodDefault<infer Inner extends z.core.SomeType> ? Inner : T;

type PartialUpdate<Shape extends z.core.$ZodShape, Config extends z.core.$ZodObjectConfig> = z.ZodObject<
  { -readonly [K in keyof Shape]: z.ZodOptional<WithoutDefault<Shape[K]>> },
  Config
>;

/**
 * `schema.partial()` for the body of an edit: a field the request leaves out
 * comes back absent, so the UPDATE leaves that column alone.
 *
 * zod 3's `.partial()` meant exactly that. zod 4 still runs a field's
 * `.default()` underneath the `.optional()`, so `blogSchema.partial()` given
 * `{ title }` answers `{ title, published: false, tags: [], … }` — every rename
 * would unpublish the post and empty its tags. The defaults belong to create,
 * where an absent field really does mean "the usual"; here each top-level one is
 * unwrapped before the field is made optional.
 *
 * Only the top level: a nested object that is sent is sent whole, and its own
 * defaults apply to it as they always did.
 */
export function partialUpdate<Shape extends z.core.$ZodShape, Config extends z.core.$ZodObjectConfig>(
  schema: z.ZodObject<Shape, Config>,
): PartialUpdate<Shape, Config> {
  const shape: Record<string, z.core.SomeType> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    shape[key] = field instanceof z.ZodDefault ? field.unwrap() : field;
  }
  return schema.extend(shape).partial() as unknown as PartialUpdate<Shape, Config>;
}
