import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/pages/admin/ui/primitives";
import { EmailDeliveryCard } from "@/pages/admin/SettingsGroup";

/**
 * The email delivery log, at an address of its own.
 *
 * The log itself is not new: it is a card on `/admin/settings/email`, and this
 * page renders the very same component rather than a second copy of it. What
 * is new is that `/admin/settings/email/log` — the URL anyone would write down
 * when asked "where do I check whether that receipt arrived?" — now resolves.
 * It matched no route before, and the admin's catch-all quietly answered with
 * the dashboard, so the one screen people are sent to when a customer says
 * "I never got the email" was the one screen they could not link to.
 */
export default function EmailLogPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/admin/settings/email"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-4" />
          Email settings
        </Link>
        <PageHeader
          eyebrow="Email"
          title="Delivery log"
          description="Every message this site sent, and whether it actually arrived."
        />
      </div>

      <EmailDeliveryCard />
    </div>
  );
}
