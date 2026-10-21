/** Owner-supplied Google resources are opened only after normal product/lesson
 * entitlement and signed-link checks. Never fetch arbitrary external URLs. */
export function externalResourceUrl(reference: string): string | null {
  try {
    const u = new URL(reference);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    if (u.hostname === "docs.google.com" && /^\/document\/d\/[A-Za-z0-9_-]+\/(copy|edit|view)$/.test(u.pathname)) return u.href;
    if (u.hostname === "drive.google.com" && /^\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(u.pathname)) return u.href;
  } catch { /* A normal protected storage path. */ }
  return null;
}
