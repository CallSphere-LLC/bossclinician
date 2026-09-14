import type { ReactNode } from "react";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { receiptPaths, type ReceiptTarget } from "@/lib/billingApi";

/**
 * "Download PDF" as a plain link to the PDF's permanent address.
 *
 * /account/purchases/:orderId/receipt.pdf (and the billing invoice equivalent)
 * is served by the server: nginx sends it to the API, which answers with the PDF
 * as an attachment, authenticated by the member's document cookie — an HttpOnly
 * cookie scoped to /account/ and tied to their session
 * (backend/src/auth/memberDocumentCookie.ts). So an ordinary <a href> is the
 * whole feature: a click saves the file without leaving the page, and the same
 * URL works bookmarked, in a new tab, forwarded to a bookkeeper who signs in,
 * or fetched by `curl` with a session cookie.
 *
 * Signed out, the server sends the browser to /login and back to this address;
 * the app's own route for it then downloads through a signed link.
 */
export function ReceiptPdfLink({
  target,
  className,
  children,
}: {
  target: ReceiptTarget;
  className?: string;
  children: ReactNode;
}) {
  return (
    <LuxeButton href={receiptPaths(target).pdfPage} variant="quiet" className={className}>
      {children}
    </LuxeButton>
  );
}
