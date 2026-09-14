import { Request, Response, Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { asyncHandler } from "../../utils/asyncHandler";
import { escapeHtml } from "../../email/templates";
import { optionalMember, type AuthedMember } from "../../middleware/memberAuth";
import { memberFromDocumentCookie } from "../../auth/memberDocumentCookie";
import {
  loadReceiptDocument,
  renderReceiptPdf,
  type ReceiptTarget,
} from "../../services/receiptDocument";

/**
 * GET /account/purchases/:orderId/receipt.pdf
 * GET /account/billing/invoices/:invoiceId/receipt.pdf
 *
 * The receipt PDF at its permanent address, served by the server.
 *
 * These URLs used to be client-side routes: the SPA shell answered 200 text/html
 * and generated the download in the browser, so the address worked for the
 * signed-in member and for nothing else — not a bookkeeper it was forwarded to,
 * not a server-side fetch, not a support ticket attachment. nginx now sends
 * exactly these two shapes here (nginx/site.conf); the HTML receipt pages beside
 * them are still the SPA's.
 *
 * Who is asking:
 *  - a browser navigation carries the document cookie (auth/memberDocumentCookie.ts),
 *    which is scoped to /account/ and tied to a live session;
 *  - an API client may send `Authorization: Bearer <access token>` instead.
 *
 * What they get:
 *  - the owner: the PDF, as an attachment named after the receipt number;
 *  - nobody signed in: a browser is sent to /login and back here; anything else
 *    gets 401;
 *  - somebody else's receipt, or one that does not exist: the same 404 with the
 *    same words the receipt page uses, byte for byte, so a probe learns nothing.
 */
export const accountReceiptsRouter = Router();

const RECEIPT_MISSING = "We couldn't find that receipt.";
const SIGN_IN = "Please sign in to continue";
const MAX_INT4 = 2_147_483_647;

/** Keyed on the member where there is one; the ids are sequential and worth scraping. */
const accountReceiptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
  keyGenerator: (req: Request): string =>
    req.member ? `member:${req.member.id}` : `ip:${ipKeyGenerator(req.ip ?? "")}`,
});

/** A browser navigation, as opposed to curl or a script: it asks for HTML. */
function wantsHtml(req: Request): boolean {
  return /\btext\/html\b/.test(String(req.headers.accept ?? ""));
}

function readId(raw: unknown): number | null {
  const value = String(raw ?? "");
  if (!/^[1-9]\d{0,9}$/.test(value)) return null;
  const id = Number(value);
  return id <= MAX_INT4 ? id : null;
}

/** Headers every answer from here carries, found or not. */
function privateHeaders(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Cookie, Authorization, Accept");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

/**
 * The refusal for "not yours" and "not there", identical for both.
 *
 * A browser gets a small page with the receipt page's own heading rather than a
 * raw JSON body; anything else gets the JSON the member API sends.
 */
function sendMissing(req: Request, res: Response): void {
  privateHeaders(res);
  res.status(404);
  if (wantsHtml(req)) {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
    );
    res.type("html").send(missingPage());
    return;
  }
  res.json({ error: RECEIPT_MISSING });
}

function missingPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Receipt not found | Boss Clinician</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #14091d; color: #f3e9f7; font: 16px/1.5 system-ui, sans-serif; padding: 24px; box-sizing: border-box; }
  main { max-width: 32rem; }
  h1 { font-size: 1.4rem; margin: 0 0 .5rem; color: #fff; }
  p { margin: 0 0 1rem; color: #c9b6d3; }
  a { color: #e5c07b; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml("We couldn’t find that receipt")}</h1>
  <p>${escapeHtml("Check the link, or find the purchase in your list — every one has its receipt.")}</p>
  <p><a href="/account/purchases">Go to your purchases</a></p>
</main>
</body>
</html>`;
}

/** Signed out. A browser is sent to sign in and brought back; a script is told. */
function sendSignedOut(req: Request, res: Response): void {
  privateHeaders(res);
  if (wantsHtml(req)) {
    // The path alone, never a host: /login only honours same-site paths anyway.
    const next = req.originalUrl.split("?")[0];
    res.redirect(302, `/login?next=${encodeURIComponent(next)}`);
    return;
  }
  res.status(401).json({ error: SIGN_IN });
}

/**
 * Bearer first (an API client said who it is), then the document cookie.
 *
 * `optionalMember` has already read the header; a bad or expired Bearer token
 * leaves `req.member` unset and the cookie is tried, so a browser with a stale
 * header-less request and a live cookie still gets through.
 */
async function resolveMember(req: Request): Promise<AuthedMember | null> {
  if (req.member) return req.member;
  const member = await memberFromDocumentCookie(req);
  if (member) req.member = member;
  return member;
}

function serve(pick: (req: Request) => ReceiptTarget | null) {
  return [
    optionalMember,
    asyncHandler(async (req: Request, _res: Response, next) => {
      await resolveMember(req);
      next();
    }),
    accountReceiptLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const member = req.member;
      if (!member) {
        sendSignedOut(req, res);
        return;
      }

      const target = pick(req);
      if (target === null) {
        sendMissing(req, res);
        return;
      }

      // Ownership is decided inside the loader's SQL, not compared afterwards.
      const document = await loadReceiptDocument(target, {
        memberId: member.id,
        billedToEmail: member.email,
      });
      // A renewal invoice with no order has Stripe's own PDF and none of ours;
      // the member API answers that with the same 404, and so does this.
      if (!document?.pdf) {
        sendMissing(req, res);
        return;
      }

      const pdf = await renderReceiptPdf(document);
      privateHeaders(res);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${document.filename}"`);
      res.setHeader("Content-Length", String(pdf.byteLength));
      res.send(pdf);
    }),
  ];
}

accountReceiptsRouter.get(
  "/purchases/:orderId/receipt.pdf",
  ...serve((req) => {
    const orderId = readId(req.params.orderId);
    return orderId === null ? null : { orderId };
  })
);

accountReceiptsRouter.get(
  "/billing/invoices/:invoiceId/receipt.pdf",
  ...serve((req) => {
    const invoiceId = readId(req.params.invoiceId);
    return invoiceId === null ? null : { invoiceId };
  })
);
