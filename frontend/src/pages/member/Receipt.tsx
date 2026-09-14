import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { ReceiptPdfLink } from "@/components/member/ReceiptPdfLink";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { ReceiptFrame, type ReceiptFrameHandle } from "@/components/receipt/ReceiptFrame";
import { MemberApiError } from "@/lib/memberApi";
import {
  billingErrorMessage,
  downloadReceiptPdf,
  fetchReceiptHtml,
  readReceiptTarget,
  receiptPaths,
} from "@/lib/billingApi";

/**
 * A receipt at its own address.
 *
 * /account/purchases/:orderId/receipt (and /account/billing/invoices/:id/receipt)
 * is the receipt's permanent URL: it can be bookmarked, re-opened months later,
 * or linked in a support reply, and it sits behind RequireMember, so opening it
 * signed out goes to the login page and comes straight back here.
 *
 * With `download`, the same address plus `.pdf` starts the PDF download instead
 * and says so, for the cases where the link was opened on its own — a bookmark,
 * a new tab, a link in an email. The purchases page downloads without visiting.
 *
 * Somebody else's receipt, and one that does not exist, get the same answer:
 * the API returns 404 for both, and so does this page's message.
 */

type State =
  | { status: "loading" }
  | { status: "ready"; html: string }
  | { status: "downloading" }
  | { status: "missing" }
  | { status: "error"; message: string };

/** The `quiet` variant carries no padding of its own; the tap target is added back. */
const QUIET_LINK = "min-h-[44px] text-[0.72rem] tracking-[0.14em]";

export default function Receipt({ download = false }: { download?: boolean }) {
  const { orderId, invoiceId } = useParams();
  const target = readReceiptTarget({ orderId, invoiceId });
  const paths = target ? receiptPaths(target) : null;
  const key = `${paths?.page ?? "none"}:${download ? "pdf" : "html"}`;

  const back =
    target && "invoiceId" in target
      ? { to: "/account/billing", label: "Back to billing" }
      : { to: "/account/purchases", label: "Back to purchases" };

  const frame = useRef<ReceiptFrameHandle>(null);
  const alive = useRef(true);
  // One download per address, even when React runs the effect twice in dev.
  const requested = useRef("");
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    alive.current = true;
    const current = readReceiptTarget({ orderId, invoiceId });
    if (current === null) {
      setState({ status: "missing" });
      return;
    }

    const settle = (next: State) => {
      if (alive.current) setState(next);
    };
    const fail = (err: unknown) => {
      if (err instanceof MemberApiError && err.status === 404) {
        settle({ status: "missing" });
      } else {
        settle({
          status: "error",
          message: billingErrorMessage(
            err,
            "We could not open that receipt just now. Please try again in a moment.",
          ),
        });
      }
    };

    if (download) {
      if (requested.current !== key) {
        requested.current = key;
        setState({ status: "loading" });
        downloadReceiptPdf(current).then(() => settle({ status: "downloading" }), fail);
      }
    } else {
      setState({ status: "loading" });
      fetchReceiptHtml(current).then((html) => settle({ status: "ready", html }), fail);
    }

    return () => {
      alive.current = false;
    };
  }, [orderId, invoiceId, download, key]);

  return (
    <MemberShell
      title={download ? "Receipt PDF" : "Receipt"}
      description={
        download
          ? "Your receipt as a PDF, ready to file or send on."
          : "Your receipt, at an address you can bookmark or come back to."
      }
    >
      <Seo title="Your Receipt | Boss Clinician" />

      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2">
        <LuxeButton to={back.to} variant="quiet" className={QUIET_LINK}>
          <span className="inline-flex items-center gap-1.5">
            <ArrowLeft aria-hidden className="size-3.5" />
            {back.label}
          </span>
        </LuxeButton>

        {target && state.status === "ready" && (
          <>
            <LuxeButton
              type="button"
              variant="quiet"
              className={QUIET_LINK}
              onClick={() => frame.current?.print()}
            >
              Print
            </LuxeButton>
            <ReceiptPdfLink target={target} className={QUIET_LINK}>
              Download PDF
            </ReceiptPdfLink>
          </>
        )}
      </div>

      <div aria-live="polite">
        {state.status === "loading" && (
          <GlassCard spotlight={false} interactive={false} className="p-6 sm:p-8">
            <p className="text-sm text-orchid-dim">
              {download ? "Preparing your PDF…" : "Loading your receipt…"}
            </p>
          </GlassCard>
        )}

        {state.status === "ready" && (
          <ReceiptFrame ref={frame} html={state.html} title="Receipt" />
        )}

        {state.status === "downloading" && target && paths && (
          <GlassCard spotlight={false} interactive={false} className="p-6 sm:p-8">
            <p className="text-sm text-orchid">
              Your receipt PDF is downloading. If nothing arrives, download it again.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
              <ReceiptPdfLink target={target} className={QUIET_LINK}>
                Download again
              </ReceiptPdfLink>
              <LuxeButton to={paths.page} variant="quiet" className={QUIET_LINK}>
                View the receipt
              </LuxeButton>
            </div>
          </GlassCard>
        )}

        {state.status === "missing" && (
          <GlassCard spotlight={false} interactive={false} className="p-6 sm:p-8">
            <h2 className="font-display text-xl text-white">We couldn&rsquo;t find that receipt</h2>
            <p className="mt-2 text-sm text-orchid-dim">
              Check the link, or find the purchase in your list — every one has its receipt.
            </p>
          </GlassCard>
        )}

        {state.status === "error" && (
          <GlassCard spotlight={false} interactive={false} className="p-6 sm:p-8">
            <p role="alert" className="text-sm font-medium text-red-400">
              {state.message}
            </p>
          </GlassCard>
        )}
      </div>
    </MemberShell>
  );
}
