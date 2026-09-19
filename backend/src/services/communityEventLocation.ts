import { badRequest } from "../utils/httpError";

/** Empty locations are the community's own room; external links stay explicit. */
export function communityEventLocation(
  body: Record<string, unknown>,
  creating = false,
): { locationUrl: string; native: boolean } | null {
  if (
    !creating &&
    body.joinMode === undefined &&
    body.locationUrl === undefined
  )
    return null;
  const mode = body.joinMode ?? (body.locationUrl ? "external" : "native");
  if (mode === "native") return { locationUrl: "", native: true };
  if (mode !== "external")
    throw badRequest("Choose the community live room or an external meeting.");
  if (typeof body.locationUrl !== "string")
    throw badRequest("Enter the external meeting URL.");
  let url: URL;
  try {
    url = new URL(body.locationUrl.trim());
  } catch {
    throw badRequest("Enter a valid external meeting URL.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw badRequest(
      "Use an HTTP or HTTPS meeting URL without embedded credentials.",
    );
  }
  return { locationUrl: url.href, native: false };
}
