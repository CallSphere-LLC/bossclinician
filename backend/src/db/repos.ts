import { createCrudRepo } from "./repo";
import { BlogPost, Course, Resource, Testimonial } from "../types";

export const blogRepo = createCrudRepo<BlogPost>("blog_posts", [
  "slug",
  "title",
  "excerpt",
  "bodyMd",
  "coverImage",
  "tags",
  "author",
  "readMinutes",
  "published",
  "publishedAt",
]);

export const coursesRepo = createCrudRepo<Course>("courses", [
  "slug",
  "title",
  "subtitle",
  "description",
  "priceText",
  "priceCents",
  "currency",
  "stripePriceId",
  "image",
  "url",
  "features",
  "sort",
  "published",
], ["features"]);

export const testimonialsRepo = createCrudRepo<Testimonial>("testimonials", [
  "name",
  "credential",
  "quote",
  "practice",
  "image",
  "sort",
  "published",
]);

export const resourcesRepo = createCrudRepo<Resource>("resources", [
  "slug",
  "title",
  "description",
  "image",
  "ctaLabel",
  "ctaUrl",
  "kind",
  "sort",
  "published",
]);
