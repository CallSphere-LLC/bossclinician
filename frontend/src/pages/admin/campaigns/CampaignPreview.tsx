import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { Badge, Button } from "@/pages/admin/ui/primitives";
import { Modal } from "@/pages/admin/ui/Dialog";
import {
  EMAIL_KIND_LABEL,
  campaignKind,
  campaignStatus,
  longDateTime,
  looksLikeHtml,
  percentOf,
  statusLabelFor,
  type CampaignRecord,
} from "@/pages/admin/campaigns/emailList";

/**
 * A read-only look at an email that has already gone out — in practice the
 * history imported from Kajabi, which is a record of what was sent and not
 * something to edit or send again. "Make a copy" is the way to reuse it.
 *
 * Kajabi's bodies are HTML. They are shown in a sandboxed frame with no
 * scripts and no same-origin access, so whatever markup came across can only
 * be looked at; the composer's own Markdown renders the way its preview does.
 */
export default function CampaignPreview({
  campaign,
  onOpenChange,
  onDuplicate,
}: {
  campaign: CampaignRecord | null;
  onOpenChange: (open: boolean) => void;
  onDuplicate: (campaign: CampaignRecord) => void;
}) {
  const kind = campaign ? campaignKind(campaign) : "broadcast";
  const status = campaign ? campaignStatus(campaign) : "draft";
  const body = campaign?.bodyMd ?? "";
  const sends = campaign?.recipientCount ?? 0;

  return (
    <Modal
      open={campaign !== null}
      onOpenChange={onOpenChange}
      title={campaign?.name || campaign?.subject || "Email"}
      description={
        campaign?.sentAt
          ? `Sent ${longDateTime(campaign.sentAt, campaign.timezone || undefined)}`
          : undefined
      }
      size="xl"
      footer={
        <>
          {campaign && (
            <Button variant="secondary" size="sm" onClick={() => onDuplicate(campaign)}>
              <Copy />
              Make a copy
            </Button>
          )}
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </>
      }
    >
      {campaign && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={kind === "sequence" ? "plum" : kind === "event" ? "gold" : "blue"}>
              {EMAIL_KIND_LABEL[kind]}
            </Badge>
            <Badge tone={status === "sent" ? "green" : "slate"}>{statusLabelFor({ kind, status })}</Badge>
            {campaign.folder && <Badge tone="slate">{campaign.folder}</Badge>}
            {(campaign.source === "kajabi" || campaign.kajabiId != null) && (
              <span className="text-xs text-ink-soft">Imported from Kajabi — read only</span>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-3 rounded-xl border border-hairline bg-white/[0.03] p-4 sm:grid-cols-4">
            <Stat label="Sends" value={formatNumber(sends)} />
            <Stat label="Opened" value={percentOf(campaign.openedCount ?? 0, sends)} />
            <Stat label="Clicked" value={percentOf(campaign.clickedCount ?? 0, sends)} />
            <Stat label="Unsubscribed" value={percentOf(campaign.unsubscribedCount ?? 0, sends)} />
          </dl>

          <div className="space-y-1 text-sm">
            <p>
              <span className="text-ink-soft">Subject: </span>
              <strong className="text-ink">{campaign.subject || "No subject line"}</strong>
            </p>
            {campaign.previewText && (
              <p>
                <span className="text-ink-soft">Preview line: </span>
                <span className="text-ink">{campaign.previewText}</span>
              </p>
            )}
          </div>

          {!body.trim() ? (
            <p className="rounded-xl border border-hairline bg-white/[0.03] p-4 text-sm text-ink-soft">
              The message itself didn't come across with this email.
            </p>
          ) : looksLikeHtml(body) ? (
            <iframe
              title={`The message of ${campaign.name || "this email"}`}
              sandbox=""
              srcDoc={body}
              className="h-[32rem] w-full rounded-xl border border-hairline bg-white"
            />
          ) : (
            <div className="prose-boss max-h-[32rem] overflow-y-auto rounded-xl border border-hairline bg-white/[0.03] p-4">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="font-bold tabular-nums text-lg text-ink">{value}</dd>
    </div>
  );
}
