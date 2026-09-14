import type { DmThread, DmThreadSummary } from "./communityApi";

/**
 * What the Messages list shows beside an open conversation.
 *
 * The server lists only conversations somebody has written in
 * (`last_message_at IS NOT NULL`), on purpose: opening a profile's Message
 * target creates the thread row before anyone types, so listing empty rows
 * would tell the other person "X opened a conversation with you" when X never
 * wrote a word, and would leave a draft behind for every profile anyone
 * glanced at.
 *
 * That filter is right for the list and wrong for the screen the member is
 * looking at: with a brand-new conversation open on the right, the list said
 * "No conversations yet". So the open conversation is always in the list for
 * the person who opened it — synthesised from the thread they are reading until
 * the first message makes the server list it — and nobody else sees it.
 */
export function conversationList(
  threads: readonly DmThreadSummary[],
  openWith: number | null,
  open: DmThread | null,
): DmThreadSummary[] {
  if (openWith === null) return [...threads];
  if (threads.some((t) => t.otherMemberId === openWith)) return [...threads];
  // A thread still in state from the previous conversation is not this one.
  if (!open || open.other.memberId !== openWith) return [...threads];

  const last = open.messages[open.messages.length - 1];
  return [
    {
      id: open.threadId,
      otherMemberId: open.other.memberId,
      otherName: open.other.name,
      otherAvatarUrl: open.other.avatarUrl,
      lastMessageAt: last?.at ?? null,
      preview: last ? last.body.slice(0, 140) : "",
      // Reading it is what marked it read.
      unread: 0,
    },
    ...threads,
  ];
}

export type ConversationPane = "list" | "opening" | "empty";

/**
 * Whether the list pane lists, waits, or says there is nothing.
 *
 * "No conversations yet" is only said when it is true: never while a
 * conversation is on its way in, and never while one is open. If opening it
 * failed there is nothing to show, and the empty state is honest again.
 */
export function conversationPane(
  rows: readonly DmThreadSummary[],
  openWith: number | null,
  open: DmThread | null,
  openFailed: boolean,
): ConversationPane {
  if (rows.length > 0) return "list";
  if (openWith !== null && !openFailed && open?.other.memberId !== openWith) return "opening";
  return "empty";
}
