import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isZodError, zodFields, zodMessage } from "./errorHandler";

/**
 * Roughly thirty admin routes validate with `schema.parse(req.body)`, which
 * throws rather than returning a result. Nothing in the error handler knew what
 * a `ZodError` was, so every one of them answered a mistyped form with HTTP
 * 500 — and the admin renders a 500 as "something went wrong on our end",
 * i.e. tells the business owner the site is broken when what happened is that
 * she left a field empty.
 *
 * These tests pin the sentence she gets instead, and pin what must NOT be in
 * it: the shape of our schemas, and zod's own parser vocabulary.
 */

function errorFrom(schema: z.ZodTypeAny, value: unknown): z.ZodError {
  const parsed = schema.safeParse(value);
  if (parsed.success) throw new Error("expected the schema to reject this value");
  return parsed.error;
}

describe("isZodError", () => {
  it("recognises a real one", () => {
    expect(isZodError(errorFrom(z.object({ title: z.string() }), {}))).toBe(true);
  });

  it("recognises one thrown by a second copy of zod", () => {
    // A duplicate zod in the tree produces an error that fails `instanceof`
    // while being identical in every way this handler cares about. Without the
    // shape test those routes would quietly go back to answering 500.
    expect(isZodError({ name: "ZodError", issues: [] })).toBe(true);
  });

  it("leaves everything else to the branches below it", () => {
    expect(isZodError(new Error("connection reset"))).toBe(false);
    expect(isZodError(null)).toBe(false);
    expect(isZodError({ name: "ZodError" })).toBe(false);
    expect(isZodError("ZodError")).toBe(false);
  });
});

describe("zodMessage", () => {
  it("names the field she left empty", () => {
    const err = errorFrom(z.object({ title: z.string() }), {});
    expect(zodMessage(err)).toBe(`Please fill in "Title" — it can't be left empty.`);
  });

  it("writes a machine key the way the screen labels it", () => {
    expect(zodMessage(errorFrom(z.object({ ctaLabel: z.string() }), {}))).toContain('"Cta label"');
    expect(zodMessage(errorFrom(z.object({ first_name: z.string() }), {}))).toContain(
      '"First name"'
    );
  });

  it("says too short and too long in those words", () => {
    const schema = z.object({ excerpt: z.string().min(10).max(20) });
    expect(zodMessage(errorFrom(schema, { excerpt: "hi" }))).toBe(
      `"Excerpt" is too short — please add a bit more.`
    );
    expect(zodMessage(errorFrom(schema, { excerpt: "x".repeat(50) }))).toBe(
      `"Excerpt" is too long — please shorten it.`
    );
  });

  it("falls back to one sentence about the form when it has no field to name", () => {
    const err = errorFrom(z.object({ a: z.string() }).refine(() => false), { a: "ok" });
    expect(zodMessage(err)).toBe(
      "Something in that form needs fixing — check the highlighted fields."
    );
    // A body that is not an object at all: the failure is the whole payload.
    expect(zodMessage(errorFrom(z.object({ a: z.string() }), "nonsense"))).toBe(
      "Something in that form needs fixing — check the highlighted fields."
    );
  });

  it("never quotes zod at her", () => {
    const messages = [
      zodMessage(errorFrom(z.object({ price: z.number() }), { price: "free" })),
      zodMessage(errorFrom(z.object({ email: z.string().email() }), { email: "nope" })),
      zodMessage(errorFrom(z.object({ status: z.enum(["draft", "live"]) }), { status: "x" })),
    ];
    for (const message of messages) {
      expect(message).not.toMatch(/expected|received|invalid_/i);
      // `friendlyError` in the admin discards a 400 whose text starts "Invalid"
      // or runs past 200 characters, and shows its own generic line instead —
      // which would put us back where we started.
      expect(message.length).toBeLessThanOrEqual(200);
      expect(message).not.toMatch(/^invalid\b/i);
    }
  });

  it("does not spell out where in the schema the failure was", () => {
    const schema = z.object({
      sections: z.array(z.object({ blocks: z.array(z.object({ href: z.string() })) })),
    });
    const message = zodMessage(errorFrom(schema, { sections: [{ blocks: [{}] }] }));
    // "sections.0.blocks.0.href" is our own internals; she gets the field the
    // screen calls it, and nothing about how the payload is nested.
    expect(message).toBe(`Please fill in "Sections" — it can't be left empty.`);
    expect(message).not.toContain("blocks");
    expect(message).not.toContain("0");
  });
});

describe("zodFields", () => {
  it("lists every field at fault, once each, by its screen name", () => {
    const schema = z.object({
      title: z.string(),
      ctaLabel: z.string(),
      body: z.string().min(5),
    });
    expect(zodFields(errorFrom(schema, { body: "hi" }))).toEqual(["Title", "Cta label", "Body"]);
  });

  it("is empty rather than wrong when nothing names a field", () => {
    expect(zodFields(errorFrom(z.object({ a: z.string() }), "nonsense"))).toEqual([]);
  });
});
