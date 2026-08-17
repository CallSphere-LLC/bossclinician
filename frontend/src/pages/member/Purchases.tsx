import { Receipt } from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";

/**
 * Purchases.
 *
 * The table header, sort order and column set all wait for Phase 2 — until
 * real orders exist there is nothing to sort, and a table of invented rows
 * would be worse than an honest blank page.
 *
 * TODO(phase 2): wire this page to the member purchase endpoints, which mount
 * under the already-authenticated `/api/member` router:
 *   - GET /api/member/purchases            → one row per order: item, date, amount, status
 *   - GET /api/member/purchases/:id        → line items and refund state for one order
 *   - GET /api/member/purchases/:id/receipt → the hosted receipt to open or print
 */
export default function Purchases() {
  return (
    <MemberShell
      title="Purchases"
      description="Every course, retreat and resource you have bought, with a receipt for each one."
    >
      <Seo title="Your Purchases | Boss Clinician" />

      <GlassCard
        spotlight={false}
        interactive={false}
        className="flex flex-col items-center px-6 py-16 text-center sm:px-8"
      >
        <span
          aria-hidden
          className="grid size-14 place-items-center rounded-full border border-gold/25 bg-gold/[0.08]"
        >
          <Receipt className="size-6 text-gold" />
        </span>

        <h2 className="mt-6 font-display text-2xl text-white">Nothing here yet</h2>
        <p className="copy-luxe mt-3 max-w-md text-balance text-sm">
          Your invoices and receipts will appear here after your first purchase — you will never
          have to dig through your email to find one.
        </p>

        <div className="mt-8">
          <LuxeButton to="/courses" variant="foil" size="sm">
            See what is available
          </LuxeButton>
        </div>
      </GlassCard>
    </MemberShell>
  );
}
