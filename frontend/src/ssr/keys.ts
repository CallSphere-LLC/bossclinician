/**
 * The names a server loader files its result under and a page reads it back by.
 *
 * Re-exported from `entry-server.tsx`, so the backend's loaders call these
 * exact functions rather than repeating the strings. A key that only matched by
 * convention would fail silently: the page would simply fetch again on mount
 * and the mismatch would show up as a flicker in production, not as an error.
 */
export const ssrKeys = {
  testimonials: () => "testimonials",
  courses: () => "courses",
  resources: () => "resources",
  /** The archive listing. One key per tag filter — they are different pages. */
  blogList: (tag?: string) => `blog:list:${tag ?? ""}`,
  blogPost: (slug: string) => `blog:post:${slug}`,
  courseDetail: (slug: string) => `course:${slug}`,
} as const;
