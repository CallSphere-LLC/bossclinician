import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button, ErrorNotice, PageHeader } from "@/pages/admin/ui/primitives";
import { ReceiptFrame, type ReceiptFrameHandle } from "@/components/receipt/ReceiptFrame";
import {
  AdminDocumentError,
  downloadAdminDocument,
  fetchAdminDocument,
} from "@/lib/adminReceipt";

/**
 * /admin/sales/invoices/:id/receipt — any customer's receipt, as the office sees it.
 *
 * The same document the member holds, from the same loader, at an address that
 * can be bookmarked or pasted into a note. Behind the admin sign-in like every
 * other admin page, and backed by `orders.view` on the API.
 */
export function AdminReceiptPage() {
  const { id } = useParams();
  const invoiceId = id !== undefined && /^[1-9]\d{0,9}$/.test(id) ? Number(id) : null;

  const frame = useRef<ReceiptFrameHandle>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    if (invoiceId === null) {
      setError("We couldn't find that receipt.");
      return;
    }
    fetchAdminDocument(`/admin/sales/invoices/${invoiceId}/receipt`)
      .then((markup) => {
        if (!cancelled) setHtml(markup);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof AdminDocumentError
            ? err.message
            : "We could not open that receipt just now. Try again in a moment.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  async function downloadPdf() {
    if (invoiceId === null) return;
    setDownloading(true);
    try {
      await downloadAdminDocument(
        `/admin/sales/invoices/${invoiceId}/receipt.pdf`,
        `receipt-${invoiceId}.pdf`,
      );
    } catch (err) {
      toast.error(
        err instanceof AdminDocumentError && err.status === 404
          ? "There's no PDF of ours for this one. A subscription renewal has Stripe's copy instead."
          : "We could not download that receipt just now.",
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Receipt"
        description="Exactly what the customer holds. This page's address can be bookmarked."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/sales/invoices">
            <ArrowLeft />
            All receipts
          </Link>
        </Button>
        {html !== null && (
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => frame.current?.print()}>
              <Printer />
              Print
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={downloading}
              onClick={() => void downloadPdf()}
            >
              <Download />
              {downloading ? "Downloading…" : "Download PDF"}
            </Button>
          </>
        )}
      </div>

      {error && <ErrorNotice message={error} />}
      {html === null && !error && <p className="text-sm text-ink-soft">Loading the receipt…</p>}
      {html !== null && <ReceiptFrame ref={frame} html={html} title="Receipt" />}
    </div>
  );
}
