import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { SmilePlus } from "lucide-react";
import { toast } from "sonner";
import { MemberApiError } from "@/lib/memberApi";
import { communityApi, type PostReaction } from "@/lib/communityApi";
import { cn } from "@/lib/cn";

/**
 * The reaction row under a post.
 *
 * Tapping one is the cheapest thing anybody does here and it happens while
 * scrolling, so the pill flips immediately and the request follows. The server's
 * tally replaces the guess when it lands, which matters more than it sounds:
 * two people reacting at once means the optimistic count is wrong by one, and
 * only the response knows the real number.
 *
 * The emoji set comes from the feed response rather than a constant in this
 * file. It is an allowlist the server enforces, and a client offering a ninth
 * face the API will refuse is a button that exists only to fail.
 */

interface ReactionBarProps {
  postId: number;
  reactions: PostReaction[];
  available: string[];
  onChange: (reactions: PostReaction[]) => void;
  /** An unverified member can react; a hidden or locked post is still readable. */
  disabled?: boolean;
}

/** The optimistic guess: what this row looks like the instant it is tapped. */
function toggled(list: PostReaction[], emoji: string): PostReaction[] {
  const existing = list.find((r) => r.emoji === emoji);
  if (!existing) return [...list, { emoji, count: 1, mine: true }];

  return list
    .map((r) =>
      r.emoji === emoji
        ? { ...r, count: r.mine ? Math.max(0, r.count - 1) : r.count + 1, mine: !r.mine }
        : r,
    )
    .filter((r) => r.count > 0);
}

export function ReactionBar({
  postId,
  reactions,
  available,
  onChange,
  disabled = false,
}: ReactionBarProps) {
  // Keyed by emoji rather than a single boolean: reacting with 👍 must not
  // freeze 🎉, which is a different row and a different request.
  const [pending, setPending] = useState<string[]>([]);

  const toggle = async (emoji: string) => {
    if (disabled || pending.includes(emoji)) return;

    const before = reactions;
    const mine = before.some((r) => r.emoji === emoji && r.mine);
    setPending((p) => [...p, emoji]);
    onChange(toggled(before, emoji));

    try {
      const result = mine
        ? await communityApi.unreact(postId, emoji)
        : await communityApi.react(postId, emoji);
      onChange(result.reactions);
    } catch (err) {
      onChange(before);
      toast.error(
        err instanceof MemberApiError
          ? err.message
          : "That reaction did not save. Please try again.",
      );
    } finally {
      setPending((p) => p.filter((e) => e !== emoji));
    }
  };

  const shown = reactions.filter((r) => r.count > 0);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          onClick={() => void toggle(reaction.emoji)}
          disabled={disabled}
          aria-pressed={reaction.mine}
          aria-label={`${reaction.emoji} — ${reaction.count} ${
            reaction.count === 1 ? "person" : "people"
          }${reaction.mine ? ", including you" : ""}`}
          className={cn(
            "inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-full border px-3",
            "text-sm leading-none transition-colors duration-300",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
            "disabled:cursor-not-allowed disabled:opacity-50",
            reaction.mine
              ? "border-gold/50 bg-gold/[0.14] text-gold-bright"
              : "border-white/12 bg-white/[0.04] text-white/70 hover:border-white/25 hover:bg-white/[0.07]",
          )}
        >
          <span aria-hidden>{reaction.emoji}</span>
          <span className="text-xs font-semibold tabular-nums">{reaction.count}</span>
        </button>
      ))}

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Add a reaction"
            className={cn(
              "grid size-11 place-items-center rounded-full border border-white/12 bg-white/[0.03]",
              "text-orchid-dim transition-colors duration-300",
              "hover:border-gold/40 hover:bg-white/[0.07] hover:text-gold",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <SmilePlus aria-hidden className="size-4" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          {/* The portal escapes `.theme-luxe`, so the surface colour is named
              outright here rather than taken from the themeable tokens. */}
          <DropdownMenu.Content
            align="start"
            sideOffset={8}
            className="z-50 flex max-w-[16rem] flex-wrap gap-1 rounded-2xl border border-white/10 bg-night-raised p-2 shadow-[0_28px_60px_-20px_rgba(0,0,0,0.9)]"
          >
            {available.map((emoji) => {
              const mine = reactions.some((r) => r.emoji === emoji && r.mine);
              return (
                <DropdownMenu.Item key={emoji} asChild>
                  <button
                    type="button"
                    onClick={() => void toggle(emoji)}
                    aria-label={mine ? `Remove ${emoji}` : `React with ${emoji}`}
                    className={cn(
                      "grid size-11 cursor-pointer place-items-center rounded-xl text-lg outline-none",
                      "transition-colors duration-200 data-[highlighted]:bg-white/[0.09]",
                      mine && "bg-gold/[0.14]",
                    )}
                  >
                    <span aria-hidden>{emoji}</span>
                  </button>
                </DropdownMenu.Item>
              );
            })}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
