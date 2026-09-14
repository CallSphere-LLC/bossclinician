import { describe, expect, it } from "vitest";
import type { DmThread, DmThreadSummary } from "./communityApi";
import { conversationList, conversationPane } from "./dmConversations";

const summary = (otherMemberId: number, over: Partial<DmThreadSummary> = {}): DmThreadSummary => ({
  id: otherMemberId * 10,
  otherMemberId,
  otherName: `ZZ Member ${otherMemberId}`,
  otherAvatarUrl: "",
  lastMessageAt: "2026-09-12T00:00:00.000Z",
  preview: "hello",
  unread: 0,
  ...over,
});

const openThread = (memberId: number, messages: DmThread["messages"] = []): DmThread => ({
  threadId: 900 + memberId,
  other: { memberId, name: `ZZ Member ${memberId}`, avatarUrl: "" },
  messages,
});

describe("Messages list beside an open conversation", () => {
  it("lists a brand-new, empty conversation while it is open, instead of 'No conversations yet'", () => {
    const rows = conversationList([], 54, openThread(54));
    expect(rows).toEqual([
      {
        id: 954,
        otherMemberId: 54,
        otherName: "ZZ Member 54",
        otherAvatarUrl: "",
        lastMessageAt: null,
        preview: "",
        unread: 0,
      },
    ]);
    expect(conversationPane(rows, 54, openThread(54), false)).toBe("list");
  });

  it("puts the open empty conversation above the ones that already have messages", () => {
    const rows = conversationList([summary(7), summary(8)], 54, openThread(54));
    expect(rows.map((r) => r.otherMemberId)).toEqual([54, 7, 8]);
  });

  it("does not duplicate a conversation the server already lists", () => {
    const listed = [summary(54, { unread: 0 }), summary(7)];
    expect(conversationList(listed, 54, openThread(54))).toEqual(listed);
  });

  it("ignores a thread left in state from the previous conversation", () => {
    expect(conversationList([], 54, openThread(7))).toEqual([]);
    expect(conversationPane([], 54, openThread(7), false)).toBe("opening");
  });

  it("previews the message just sent until the server's list catches up", () => {
    const rows = conversationList([], 54, openThread(54, [{ id: 1, mine: true, body: "ZZ hi", at: "2026-09-12T01:00:00.000Z" }]));
    expect(rows[0]).toMatchObject({ preview: "ZZ hi", lastMessageAt: "2026-09-12T01:00:00.000Z", unread: 0 });
  });

  it("says 'No conversations yet' only when nothing is open and nothing is listed", () => {
    expect(conversationPane(conversationList([], null, null), null, null, false)).toBe("empty");
    // Waiting for the conversation to load is not the same as having none.
    expect(conversationPane(conversationList([], 54, null), 54, null, false)).toBe("opening");
    // Opening it failed: there is genuinely nothing to list.
    expect(conversationPane(conversationList([], 54, null), 54, null, true)).toBe("empty");
  });
});
