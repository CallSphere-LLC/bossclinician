import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Flame, Hourglass } from "lucide-react";
import { toast } from "sonner";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { luxeControlClass } from "@/components/luxe/LuxeField";
import { SidebarPanel } from "@/components/community/SidebarPanel";
import { MemberApiError } from "@/lib/memberApi";
import { communityApi, safeLink, type Challenge } from "@/lib/communityApi";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * Challenges, and where the member stands in each.
 *
 * An entry can be revised right up until it is approved and not afterwards —
 * the points were awarded against the proof somebody checked, and letting that
 * proof change under them would make the award meaningless. The server enforces
 * it; the form here goes read-only at the same moment so nobody types a revision
 * that was never going to be accepted.
 */

export function ChallengesPanel({ communitySlug }: { communitySlug: string }) {
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await communityApi.challenges(communitySlug);
        if (!cancelled) {
          setChallenges(data.challenges);
          setError("");
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof MemberApiError ? err.message : "We could not load the challenges.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [communitySlug]);

  const replace = (next: Challenge) =>
    setChallenges((current) => (current ?? []).map((c) => (c.id === next.id ? next : c)));

  return (
    <SidebarPanel
      title="Challenges"
      icon={<Flame aria-hidden className="size-4 text-gold" />}
      loading={challenges === null && !error}
      error={error}
      isEmpty={challenges?.length === 0}
      empty="No challenges running right now."
    >
      <ul className="flex flex-col gap-5">
        {challenges?.map((challenge) => (
          <li
            key={challenge.id}
            className="border-b border-white/[0.07] pb-5 last:border-0 last:pb-0"
          >
            <ChallengeRow challenge={challenge} onChange={replace} />
          </li>
        ))}
      </ul>
    </SidebarPanel>
  );
}

function ChallengeRow({
  challenge,
  onChange,
}: {
  challenge: Challenge;
  onChange: (challenge: Challenge) => void;
}) {
  const entry = challenge.myEntry;
  const approved = entry?.approved ?? false;

  const [editing, setEditing] = useState(false);
  const [proofUrl, setProofUrl] = useState(entry?.proofUrl ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (proofUrl.trim() && !safeLink(proofUrl.trim())) {
      toast.error("That link needs to start with http:// or https://");
      return;
    }
    setSaving(true);
    try {
      const result = await communityApi.enterChallenge(challenge.id, {
        proofUrl: proofUrl.trim() || undefined,
        note: note.trim(),
      });
      onChange({
        ...challenge,
        entryCount: entry ? challenge.entryCount : challenge.entryCount + 1,
        myEntry: {
          id: result.entryId ?? entry?.id ?? 0,
          approved: result.approved,
          proofUrl: result.proofUrl ?? proofUrl.trim(),
          note: result.note ?? note.trim(),
          enteredAt: result.enteredAt ?? entry?.enteredAt ?? new Date().toISOString(),
        },
      });
      setEditing(false);
      toast.success(entry ? "Your entry was updated." : "You're in.");
    } catch (err) {
      toast.error(
        err instanceof MemberApiError
          ? err.message
          : "We could not save that entry. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold leading-snug text-white">{challenge.title}</p>
        {challenge.points > 0 && (
          <span className="shrink-0 rounded-full bg-gold/[0.12] px-2.5 py-1 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-gold">
            {challenge.points} pts
          </span>
        )}
      </div>

      {challenge.description && (
        <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-orchid-dim">
          {challenge.description}
        </p>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-orchid-faint">
        {challenge.endsAt && (
          <span className="inline-flex items-center gap-1.5">
            <Clock aria-hidden className="size-3.5" />
            Closes {formatDate(challenge.endsAt)}
          </span>
        )}
        <span>
          {challenge.entryCount} {challenge.entryCount === 1 ? "entry" : "entries"}
        </span>
      </p>

      {entry && !editing && (
        <p
          className={cn(
            "mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5",
            "text-[0.65rem] font-semibold uppercase tracking-[0.12em]",
            approved ? "bg-green-bright/[0.12] text-green-bright" : "bg-white/[0.06] text-orchid",
          )}
        >
          {approved ? (
            <CheckCircle2 aria-hidden className="size-3.5" />
          ) : (
            <Hourglass aria-hidden className="size-3.5" />
          )}
          {approved ? "Approved" : "Entered — waiting to be checked"}
        </p>
      )}

      {approved && entry?.note && (
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-orchid-dim">
          {entry.note}
        </p>
      )}

      {!challenge.open && !entry && (
        <p className="mt-3 text-xs text-orchid-faint">
          {challenge.startsAt && new Date(challenge.startsAt) > new Date()
            ? `Opens ${formatDate(challenge.startsAt)}.`
            : "This one has closed."}
        </p>
      )}

      {challenge.open && !approved && !editing && (
        <LuxeButton
          type="button"
          variant={entry ? "quiet" : "glass"}
          size="sm"
          className="mt-3"
          onClick={() => setEditing(true)}
        >
          {entry ? "Update my entry" : "Enter"}
        </LuxeButton>
      )}

      {editing && (
        <form
          className="mt-3 flex flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="sr-only" htmlFor={`proof-${challenge.id}`}>
            Link to your proof
          </label>
          <input
            id={`proof-${challenge.id}`}
            type="url"
            inputMode="url"
            value={proofUrl}
            maxLength={2000}
            placeholder="Link to your proof (optional)"
            onChange={(e) => setProofUrl(e.target.value)}
            className={luxeControlClass}
          />

          <label className="sr-only" htmlFor={`note-${challenge.id}`}>
            Anything you want Yvette to know
          </label>
          <textarea
            id={`note-${challenge.id}`}
            rows={3}
            value={note}
            maxLength={2000}
            placeholder="Anything you want her to know"
            onChange={(e) => setNote(e.target.value)}
            className={cn(luxeControlClass, "resize-y leading-relaxed")}
          />

          <div className="flex flex-wrap gap-2">
            <LuxeButton type="submit" size="sm" disabled={saving}>
              {saving ? "Saving…" : entry ? "Update entry" : "Enter challenge"}
            </LuxeButton>
            <LuxeButton
              type="button"
              variant="glass"
              size="sm"
              disabled={saving}
              onClick={() => {
                setProofUrl(entry?.proofUrl ?? "");
                setNote(entry?.note ?? "");
                setEditing(false);
              }}
            >
              Cancel
            </LuxeButton>
          </div>
        </form>
      )}
    </div>
  );
}
