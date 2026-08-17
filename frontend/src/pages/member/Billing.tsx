import type { ReactNode } from "react";
import { CreditCard, FileText, Repeat } from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";

/**
 * Billing.
 *
 * Phase 1 ships the furniture and nothing else. There is no billing data on the
 * member side yet, and inventing a placeholder card ending in 4242 would be a
 * lie a member could act on — so every panel states plainly that there is
 * nothing to show and points at the one thing they can actually do next.
 *
 * TODO(phase 2): wire these panels to the member billing endpoints, which mount
 * under the already-authenticated `/api/member` router:
 *   - GET    /api/member/billing/payment-method   → the card on file
 *   - PUT    /api/member/billing/payment-method   → Stripe SetupIntent exchange
 *   - GET    /api/member/billing/subscriptions    → active plans and renewal dates
 *   - DELETE /api/member/billing/subscriptions/:id → cancel at period end
 *   - GET    /api/member/billing/invoices         → invoice list with hosted PDF URLs
 */
export default function Billing() {
  return (
    <MemberShell
      title="Billing"
      description="Your payment method, any plan you are on, and every invoice we have issued you."
    >
      <Seo title="Billing | Boss Clinician" />

      <div className="grid gap-6">
        <BillingPanel
          icon={CreditCard}
          title="Payment method"
          body="Nothing here yet — the card you pay with will appear here after your first purchase."
        />

        <BillingPanel
          icon={Repeat}
          title="Your plan"
          body="You are not on a recurring plan. Anything you buy outright stays yours, with no renewal to think about."
        />

        <BillingPanel
          icon={FileText}
          title="Invoices"
          body="Nothing here yet — your invoices and receipts will appear here after your first purchase."
        >
          <LuxeButton to="/courses" variant="glass" size="sm">
            Browse the courses
          </LuxeButton>
        </BillingPanel>
      </div>
    </MemberShell>
  );
}

interface BillingPanelProps {
  icon: typeof CreditCard;
  title: string;
  body: string;
  children?: ReactNode;
}

function BillingPanel({ icon: Icon, title, body, children }: BillingPanelProps) {
  return (
    <GlassCard spotlight={false} interactive={false} className="p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <Icon aria-hidden className="mt-1 size-5 shrink-0 text-gold" />
        <div className="min-w-0">
          <h2 className="font-display text-xl text-white">{title}</h2>
          <p className="copy-luxe mt-2 max-w-xl text-sm">{body}</p>
          {children && <div className="mt-5">{children}</div>}
        </div>
      </div>
    </GlassCard>
  );
}
