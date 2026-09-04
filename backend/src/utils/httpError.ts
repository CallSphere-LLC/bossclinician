export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg = "Bad request", details?: unknown) => new HttpError(400, msg, details);
export const unauthorized = (msg = "Unauthorized") => new HttpError(401, msg);
export const forbidden = (msg = "Forbidden") => new HttpError(403, msg);
export const notFound = (msg = "Not found") => new HttpError(404, msg);
/**
 * The request was understood and refused because the server's copy of the
 * thing has moved on — a resumable upload asked to continue from an offset
 * that is no longer where the file ends, or a second tab writing to a session
 * another tab already holds. `details` carries what the caller should do next
 * (typically the offset it should actually resume from).
 */
export const conflict = (msg = "Conflict", details?: unknown) => new HttpError(409, msg, details);
export const payloadTooLarge = (msg = "Payload too large") => new HttpError(413, msg);
/** The volume is full. Distinct from a 500: retrying the same bytes will not help. */
export const insufficientStorage = (msg = "Insufficient storage") => new HttpError(507, msg);
export const serviceUnavailable = (msg = "Service unavailable") => new HttpError(503, msg);
