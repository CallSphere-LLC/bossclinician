import { API_BASE, ApiError } from "@/lib/api";
import type { HoneypotPayload } from "@/components/forms/useHoneypot";

/**
 * Sends a public form reply that carries files.
 *
 * A reply without files still goes through `api.submitForm` as JSON, exactly as
 * before. This path exists only because a file can't ride in JSON: the answers
 * travel in one `payload` field — appended first, so the server has them before
 * any file — and each file under its question's key. The honeypot pair goes
 * in the same envelope, beside `data`, exactly where the JSON path puts it.
 *
 * `Content-Type` is deliberately left unset: the browser has to write the
 * multipart boundary into it itself.
 */
export async function submitFormWithFiles(
  slug: string,
  data: Record<string, unknown>,
  email: string | undefined,
  files: Record<string, File>,
  honeypot?: HoneypotPayload,
): Promise<{ ok: true; message: string }> {
  const body = new FormData();
  body.append(
    "payload",
    JSON.stringify(email ? { data, email, ...honeypot } : { data, ...honeypot }),
  );
  for (const [key, file] of Object.entries(files)) body.append(key, file, file.name);

  const res = await fetch(`${API_BASE}/forms/${encodeURIComponent(slug)}/submit`, {
    method: "POST",
    body,
  });

  if (!res.ok) {
    let message = "Something went wrong. Please try again in a moment.";
    try {
      const parsed = (await res.json()) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // A body that isn't JSON (nginx's own 413 page, say) says nothing worth showing.
      if (res.status === 413) message = "Those files are bigger than this form accepts.";
    }
    throw new ApiError(message, res.status);
  }

  return (await res.json()) as { ok: true; message: string };
}
