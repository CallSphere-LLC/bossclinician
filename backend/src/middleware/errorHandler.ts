import { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ZodError, type ZodIssue } from "zod";
import { HttpError } from "../utils/httpError";

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: "Not found", path: req.originalUrl });
}

interface BodyParserError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
  expose?: boolean;
}

function isBodyParserJsonError(err: unknown): err is BodyParserError {
  return (
    err instanceof SyntaxError &&
    (err as BodyParserError).type === "entity.parse.failed" &&
    (err as BodyParserError).status === 400
  );
}

function isPayloadTooLargeError(err: unknown): err is BodyParserError {
  const e = err as BodyParserError;
  return (
    !!e &&
    typeof e === "object" &&
    (e.type === "entity.too.large" || e.status === 413 || e.statusCode === 413)
  );
}

/**
 * A thrown validation failure, whoever threw it.
 *
 * `instanceof` alone is not enough: a second copy of zod anywhere in the tree
 * gives a `ZodError` that fails the check while being the same object in every
 * way that matters here. The shape test is what actually decides.
 */
export function isZodError(err: unknown): err is ZodError {
  if (err instanceof ZodError) return true;
  const e = err as { name?: unknown; issues?: unknown };
  return !!e && typeof e === "object" && e.name === "ZodError" && Array.isArray(e.issues);
}

/**
 * The name of the field an issue is about, written the way it is labelled on
 * screen: `ctaLabel` → "Cta label", `first_name` → "First name".
 *
 * Only the first segment of the path is used. The rest is the shape of our own
 * schema — "sections.2.blocks.0.href" tells the business owner nothing and
 * tells everybody else how the payload is put together.
 *
 * Deliberately the same derivation as the admin's own `humanizeKey`
 * (frontend/src/pages/admin/ui/friendly.ts), so the sentence the server sends
 * names the field the same way the screen does.
 */
function fieldLabel(issue: ZodIssue): string {
  const first = issue.path.find((segment) => typeof segment === "string");
  if (typeof first !== "string" || !first) return "";
  const words = first
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

/**
 * One zod failure → one sentence the business owner can act on.
 *
 * The point of the whole clause: `schema.parse(req.body)` throws rather than
 * returning, so roughly thirty routes that use it were answering a mistyped
 * form with HTTP 500, which the admin renders as "something went wrong on our
 * end" — telling her the server is broken when what happened is that she left
 * the title empty.
 *
 * Zod's own wording ("Expected string, received number") is not reused. It
 * describes the parser's disappointment, not what she should do, and it is the
 * kind of text `friendlyError` throws away on sight.
 */
export function zodMessage(err: ZodError): string {
  const generic = "Something in that form needs fixing — check the highlighted fields.";
  const issue = err.issues[0];
  if (!issue) return generic;

  const label = fieldLabel(issue);
  if (!label) return generic;

  const missing =
    issue.code === "invalid_type" &&
    (issue.received === "undefined" || issue.received === "null" || issue.received === "nan");
  if (missing) return `Please fill in "${label}" — it can't be left empty.`;
  if (issue.code === "too_small") return `"${label}" is too short — please add a bit more.`;
  if (issue.code === "too_big") return `"${label}" is too long — please shorten it.`;
  return `"${label}" doesn't look right — please check it and try again.`;
}

/**
 * The fields at fault, for a screen that wants to highlight them.
 *
 * The `{ error, details }` envelope is the one every other 400 on this API
 * uses, and the sentence in `error` is the part the admin actually renders
 * (`friendlyError` keeps a 400's own wording when it reads like English). The
 * `details` payload here carries field *names* rather than the `flatten()` the
 * `safeParse` routes send, because zod's per-field text — "Expected string,
 * received number" — is written for a developer and this list is meant to be
 * shown.
 */
export function zodFields(err: ZodError): string[] {
  const names = new Set<string>();
  for (const issue of err.issues) {
    const label = fieldLabel(issue);
    if (label) names.add(label);
  }
  return [...names];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }

  // Before the generic branch: a schema failure is the caller's mistake, not
  // ours, and a 500 here is a form telling somebody the site is down.
  if (isZodError(err)) {
    res.status(400).json({ error: zodMessage(err), details: { fields: zodFields(err) } });
    return;
  }

  if (isBodyParserJsonError(err)) {
    res.status(400).json({ error: "Malformed JSON body" });
    return;
  }

  if (isPayloadTooLargeError(err)) {
    res.status(413).json({ error: "Payload too large" });
    return;
  }

  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    res.status(status).json({ error: "Upload failed", code: err.code });
    return;
  }

  // eslint-disable-next-line no-console
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
}
