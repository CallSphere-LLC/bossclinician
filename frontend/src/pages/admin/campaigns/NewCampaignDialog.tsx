import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, Mails, Megaphone } from "lucide-react";
import type { Sequence } from "@/lib/marketingApi";
import { Button } from "@/pages/admin/ui/primitives";
import { Modal } from "@/pages/admin/ui/Dialog";
import { NewSequenceForm } from "@/pages/admin/Sequences";

/**
 * "New Email Campaign" — Kajabi's chooser (sheet row 67).
 *
 * Two cards: a broadcast goes straight to the existing email editor; a
 * sequence asks for a name here, is created, and opens in the sequence editor.
 */

export type NewCampaignStep = "choose" | "sequence";

const SEQUENCE_FORM_ID = "new-sequence-form";

export default function NewCampaignDialog({
  open,
  initialStep = "choose",
  onOpenChange,
  onChooseBroadcast,
  onSequenceCreated,
}: {
  open: boolean;
  initialStep?: NewCampaignStep;
  onOpenChange: (open: boolean) => void;
  onChooseBroadcast: () => void;
  onSequenceCreated: (sequence: Sequence) => void;
}) {
  const [step, setStep] = useState<NewCampaignStep>(initialStep);
  const [saving, setSaving] = useState(false);

  // Each opening starts where it was asked to, not where the last one ended.
  useEffect(() => {
    if (open) setStep(initialStep);
  }, [open, initialStep]);

  const choosing = step === "choose";

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={choosing ? "New email campaign" : "New email sequence"}
      description={
        choosing
          ? "Choose the kind of email campaign you want to create."
          : "Name it now — you'll add the emails and choose when they go out next."
      }
      size={choosing ? "lg" : "md"}
      footer={
        choosing ? (
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={() => setStep("choose")} disabled={saving}>
              Back
            </Button>
            <Button size="sm" type="submit" form={SEQUENCE_FORM_ID} disabled={saving}>
              {saving ? "Creating…" : "Create sequence"}
            </Button>
          </>
        )
      }
    >
      {choosing ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ChoiceCard
            icon={<Megaphone className="size-5" />}
            iconClassName="bg-sky-500/[0.14] text-sky-300"
            title="Email Broadcast"
            description="Send a one-time email to your contacts — now, at a set time, or around an event."
            onClick={onChooseBroadcast}
          />
          <ChoiceCard
            icon={<Mails className="size-5" />}
            iconClassName="bg-plum-bright/[0.16] text-lilac"
            title="Email Sequence"
            description="A series of emails sent automatically over time to everyone who joins it."
            onClick={() => setStep("sequence")}
          />
        </div>
      ) : (
        <NewSequenceForm
          id={SEQUENCE_FORM_ID}
          onSavingChange={setSaving}
          onCreated={onSequenceCreated}
        />
      )}
    </Modal>
  );
}

function ChoiceCard({
  icon,
  iconClassName,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  iconClassName: string;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-full flex-col gap-3 rounded-2xl border border-hairline bg-white/[0.03] p-5 text-left transition-colors hover:border-gold/45 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold/20"
    >
      <span className={`inline-flex size-10 items-center justify-center rounded-xl ${iconClassName}`}>
        {icon}
      </span>
      <span className="flex items-center justify-between gap-2 font-semibold text-ink">
        {title}
        <ChevronRight className="size-4 text-ink-soft transition-transform group-hover:translate-x-0.5" />
      </span>
      <span className="text-sm leading-relaxed text-ink-soft">{description}</span>
    </button>
  );
}
