import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MemberApiError } from "@/lib/memberApi";
import { communityApi, type PostPoll } from "@/lib/communityApi";
import { cn } from "@/lib/cn";

/**
 * A poll, before and after voting.
 *
 * Results stay hidden until this member has voted. Showing the running tally to
 * somebody who has not answered yet turns a poll into a survey of what the first
 * three people said, and a locked poll they never answered stays closed rather
 * than being opened as a consolation.
 *
 * Changing your mind is a replacement, not a second vote — the server enforces
 * one row per person per poll — so the bars are redrawn from the response rather
 * than nudged locally. The arithmetic of moving a vote off one option and onto
 * another is exactly the thing that goes wrong when it is done twice.
 */

interface PollBlockProps {
  postId: number;
  poll: PostPoll;
  onChange: (poll: PostPoll) => void;
  /** A closed poll shows its results to voters and nothing to anyone else. */
  locked: boolean;
}

function percent(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 100);
}

export function PollBlock({ postId, poll, onChange, locked }: PollBlockProps) {
  const [voting, setVoting] = useState<number | null>(null);
  const voted = poll.myOptionId !== null;

  const vote = async (optionId: number) => {
    if (locked || voting !== null || optionId === poll.myOptionId) return;
    setVoting(optionId);
    try {
      const result = await communityApi.vote(postId, optionId);
      onChange({
        options: result.options,
        totalVotes: result.totalVotes,
        myOptionId: result.myOptionId,
      });
    } catch (err) {
      toast.error(
        err instanceof MemberApiError ? err.message : "Your vote did not save. Please try again.",
      );
    } finally {
      setVoting(null);
    }
  };

  return (
    <div className="mt-4">
      <ul className="flex flex-col gap-2">
        {poll.options.map((option) => {
          const share = percent(option.voteCount, poll.totalVotes);
          const chosen = option.id === poll.myOptionId;
          const busy = voting === option.id;

          return (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => void vote(option.id)}
                disabled={locked || voting !== null}
                aria-pressed={chosen}
                className={cn(
                  "relative w-full overflow-hidden rounded-xl border px-4 py-3 text-left",
                  "min-h-[2.75rem] transition-colors duration-300",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                  chosen
                    ? "border-gold/50 bg-gold/[0.08]"
                    : "border-white/12 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]",
                  (locked || voting !== null) && "cursor-not-allowed",
                  locked && !voted && "opacity-70",
                )}
              >
                {/* The bar is painted behind the label rather than beside it, so
                    a long option is never squeezed by its own result. */}
                {voted && (
                  <span
                    aria-hidden
                    style={{ width: `${share}%` }}
                    className={cn(
                      "absolute inset-y-0 left-0 transition-[width] duration-700 ease-luxe",
                      chosen ? "bg-gold/[0.16]" : "bg-ink/[0.06]",
                    )}
                  />
                )}

                <span className="relative flex items-center justify-between gap-4">
                  <span className="flex min-w-0 items-center gap-2">
                    {chosen && <Check aria-hidden className="size-4 shrink-0 text-gold" />}
                    {busy && <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />}
                    <span
                      className={cn(
                        "break-words text-sm",
                        chosen ? "font-semibold text-white" : "text-white/85",
                      )}
                    >
                      {option.label}
                    </span>
                  </span>

                  {voted && (
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-orchid">
                      {share}%
                      <span className="sr-only">
                        {" "}
                        — {option.voteCount} {option.voteCount === 1 ? "vote" : "votes"}
                      </span>
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-2.5 text-xs text-orchid-faint" aria-live="polite">
        {voted
          ? `${poll.totalVotes} ${poll.totalVotes === 1 ? "vote" : "votes"}${
              locked ? " · closed" : " · tap another option to change your mind"
            }`
          : locked
            ? "This poll is closed."
            : "Pick an option to see how everyone else answered."}
      </p>
    </div>
  );
}
