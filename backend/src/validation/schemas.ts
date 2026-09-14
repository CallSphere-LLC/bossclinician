import { z } from "zod";
import { partialUpdate } from "./partialUpdate";
import { isProtectedRef } from "../services/signedUrls";

/**
 * A picture that ends up on a page anybody can open.
 *
 * A blog cover, a course tile, a testimonial headshot: all of them are drawn for
 * readers with no account. A file uploaded into the protected directory has no
 * address at all, so the only way to render one is a link that dies within
 * hours, and a cover image that stops loading overnight is a worse outcome than
 * one that cannot be kept private. Refused where it is chosen, in the words the
 * person choosing it used.
 */
const PAID_IMAGE =
  "That picture was uploaded for people who bought it, so it can't be shown where everyone " +
  "can see it. Upload it again and choose 'anyone on the website'.";

const presentationImage = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !isProtectedRef(value), PAID_IMAGE);

export const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

export const leadSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  phone: z.string().max(40).optional(),
  message: z.string().max(4000).optional(),
  // The column is free TEXT (dynamic forms write `form:<slug>` directly), so
  // this enum is the only gate on what the *public* endpoint will accept.
  source: z.enum(["apply", "contact", "work-with-me", "income-calculator"]).default("contact"),
  meta: z.record(z.string(), z.unknown()).optional(),
  // Bot trap, written by frontend/src/components/forms/useHoneypot: a field no
  // person can see, and how long the form was on screen before it was sent.
  // Both optional — an older client that posts neither is still a valid lead.
  company: z.string().max(200).optional(),
  elapsedMs: z.number().int().nonnegative().optional(),
});

export const subscribeSchema = z.object({
  email: z.string().email().max(320),
  source: z.string().max(100).default("newsletter"),
});

export const chatSchema = z.object({
  sessionId: z.string().max(200).optional(),
  message: z.string().min(1).max(4000),
});

/**
 * Voice lines, which reach us only after the fact: the realtime stream runs
 * browser <-> OpenAI, so the widget posts each completed turn here. A turn is
 * a question and its answer, hence a batch rather than a single line.
 */
export const chatTranscriptSchema = z.object({
  sessionId: z.string().min(1).max(200),
  lines: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(50),
});

export const leadStatusSchema = z.object({
  status: z.string().min(1).max(50),
});

export const blogSchema = z.object({
  slug: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  excerpt: z.string().max(1000).default(""),
  bodyMd: z.string().max(50000).default(""),
  coverImage: presentationImage(2000).nullable().optional(),
  tags: z.array(z.string().max(50)).default([]),
  author: z.string().max(200).default("Yvette Howard, LCSW"),
  readMinutes: z.number().int().positive().default(4),
  published: z.boolean().default(false),
  publishedAt: z.string().max(50).nullable().optional(),
});
export const blogUpdateSchema = partialUpdate(blogSchema);

export const courseSchema = z.object({
  slug: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  subtitle: z.string().max(300).default(""),
  description: z.string().max(2000).default(""),
  priceText: z.string().max(100).default(""),
  // Stripe: set stripePriceId (preferred) or priceCents to make a course
  // purchasable. priceText remains the display string only.
  priceCents: z.number().int().min(0).max(99_999_999).nullable().optional(),
  currency: z.string().length(3).toLowerCase().default("usd"),
  stripePriceId: z.string().max(255).nullable().optional(),
  image: presentationImage(2000).nullable().optional(),
  url: z.string().max(2000).default("#"),
  features: z.unknown().optional(),
  sort: z.number().int().default(0),
  published: z.boolean().default(true),
});
export const courseUpdateSchema = partialUpdate(courseSchema);

export const testimonialSchema = z.object({
  name: z.string().min(1).max(200),
  credential: z.string().max(200).default(""),
  quote: z.string().max(2000).default(""),
  image: presentationImage(2000).nullable().optional(),
  sort: z.number().int().default(0),
  published: z.boolean().default(true),
});
export const testimonialUpdateSchema = partialUpdate(testimonialSchema);

export const resourceSchema = z.object({
  slug: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  description: z.string().max(2000).default(""),
  image: presentationImage(2000).nullable().optional(),
  ctaLabel: z.string().max(100).default("Download"),
  ctaUrl: z.string().max(2000).default("#"),
  kind: z.string().max(50).default("guide"),
  sort: z.number().int().default(0),
  published: z.boolean().default(true),
});
export const resourceUpdateSchema = partialUpdate(resourceSchema);

export const pageUpdateSchema = z.object({
  title: z.string().max(300).optional(),
  description: z.string().max(2000).optional(),
  sections: z.unknown().optional(),
});

export const settingsUpdateSchema = z.record(z.string(), z.unknown());

export const generateBlogSchema = z.object({
  topic: z.string().min(1).max(300),
  tone: z.string().max(100).optional(),
  keywords: z.array(z.string().max(100)).optional(),
});
