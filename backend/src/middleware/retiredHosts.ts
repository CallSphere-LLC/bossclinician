import type { RequestHandler } from "express";

const retiredHosts = new Set([
  "bossclinician.callsphere.site",
  "admin.bossclinician.com",
  "admin.bossclinician.callsphere.site",
]);

/** Match the Host routing boundary, never a client-provided forwarded host. */
export const rejectRetiredHosts: RequestHandler = (req, res, next) => {
  const host = (req.get("host") || "").toLowerCase().split(":")[0].replace(/\.$/, "");
  // Existing provider callbacks must keep their original signature checks while
  // destinations move to www. This exception exposes no browser/admin content.
  const legacyCallbacks = ["/api/stripe/webhook", "/api/paypal/webhook", "/api/email/webhook/ses"];
  if (host === "bossclinician.callsphere.site" && req.method === "POST" && legacyCallbacks.includes(req.path)) return next();
  if (!retiredHosts.has(host)) return next();
  res.set("Cache-Control", "no-store").set("X-Robots-Tag", "noindex, nofollow")
    .status(410).json({ error: "This address is no longer available.", website: "https://www.bossclinician.com/" });
};
