import { NextFunction, Request, Response } from "express";
import multer from "multer";
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
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
