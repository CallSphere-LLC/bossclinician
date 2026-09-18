import { useState } from "react";
import { toast } from "sonner";
import { MemberApiError } from "@/lib/memberApi";
import { cn } from "@/lib/cn";

/**
 * One email switch, saving itself.
 *
 * The same control the Newsletters page draws for each of its rows, lifted out
 * so the account's "Email preferences" page can show identical switches without
 * a second design for the same decision.
 *
 * Optimistic: the switch moves on the tap and moves back if the save fails,
 * because a toggle that waits on a round trip reads as broken on a phone with
 * one bar of signal.
 */
export function PreferenceSwitch<T>({
  title,
  description,
  subscribed,
  onChange,
  onSaved,
}: {
  title: string;
  description: string;
  subscribed: boolean;
  onChange: (subscribed: boolean) => Promise<T>;
  onSaved: (row: T) => void;
}) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const checked = optimistic ?? subscribed;

  const toggle = async () => {
    const next = !checked;
    setOptimistic(next);
    setSaving(true);
    try {
      onSaved(await onChange(next));
      setOptimistic(null);
    } catch (err) {
      setOptimistic(null);
      toast.error(
        err instanceof MemberApiError
          ? err.message
          : "We could not save that just now. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-orchid-faint">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={saving}
        onClick={() => void toggle()}
        className={cn(
          // 44px of tappable height around a 24px track: the switch is the
          // densest control on the page and a mis-tap here unsubscribes someone.
          "relative grid h-11 w-16 shrink-0 place-items-center rounded-full",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
          "disabled:opacity-60",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "h-6 w-11 rounded-full border transition-colors duration-300",
            checked ? "border-gold/50 bg-gold/[0.35]" : "border-white/15 bg-ink/[0.08]",
          )}
        />
        <span
          aria-hidden
          className={cn(
            "absolute size-4 rounded-full transition-transform duration-300 ease-luxe",
            checked ? "translate-x-3 bg-gold" : "-translate-x-3 bg-ink/50",
          )}
        />
      </button>
    </div>
  );
}
