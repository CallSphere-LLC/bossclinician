import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LuxeDialog } from "@/components/booking/LuxeDialog";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeTextarea } from "@/components/luxe/LuxeField";
import { MemberApiError } from "@/lib/memberApi";
import { communityApi } from "@/lib/communityApi";

/**
 * Reporting a post or a comment.
 *
 * The confirmation is deliberately flat — "thank you, Yvette will take a look"
 * and nothing else. The server answers the same way whether this is the first
 * report or the fifth, and telling a reporter what happened next is how the
 * person they reported works out who reported them.
 *
 * There is no "are you sure?" step. Somebody who has read something upsetting
 * enough to reach for this should not have to argue with a dialog about it.
 */

interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { kind: "post" | "comment"; id: number };
  /** Who wrote it, so the dialog can say what is being reported. */
  authorName: string;
}

export function ReportDialog({ open, onOpenChange, target, authorName }: ReportDialogProps) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  // A reason typed about one post must not be sitting in the box when the
  // dialog is next opened about a different one.
  useEffect(() => {
    if (open) setReason("");
  }, [open, target.id]);

  const submit = async () => {
    setSaving(true);
    try {
      if (target.kind === "post") await communityApi.reportPost(target.id, reason);
      else await communityApi.reportComment(target.id, reason);
      toast.success("Thank you — Yvette will take a look.");
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof MemberApiError
          ? err.message
          : "We could not send that report just now. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const noun = target.kind === "post" ? "post" : "comment";

  return (
    <LuxeDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Report this ${noun}`}
      description={`This goes to Yvette privately. ${authorName || "The author"} is not told who reported them.`}
      size="md"
      footer={
        <>
          <LuxeButton variant="glass" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </LuxeButton>
          <LuxeButton size="sm" onClick={() => void submit()} disabled={saving}>
            {saving ? "Sending…" : "Send report"}
          </LuxeButton>
        </>
      }
    >
      <LuxeTextarea
        label="What is wrong with it?"
        hint="Optional, but a sentence helps her deal with it faster."
        rows={4}
        maxLength={1000}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="This is spam / this is unkind / this shares somebody's private details…"
      />
    </LuxeDialog>
  );
}
