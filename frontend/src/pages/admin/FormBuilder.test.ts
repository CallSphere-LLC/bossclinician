import { describe, expect, it } from "vitest";
import type { FormSubmission } from "@/lib/formsApi";
import { fetchAllReplies, questionKey } from "./FormBuilder";

/** The rule formsV2.ts stores a key under: 60 characters, a letter first. */
const SERVER_KEY = /^[a-z][a-z0-9_]*$/;

describe("questionKey — the key a new question is filed under", () => {
  it("fits the server's 60 characters when a long numbered label is prefixed", () => {
    const label =
      "1. What is the single biggest challenge you face in growing your practice today?";
    const key = questionKey(label, []);
    expect(key.length).toBeLessThanOrEqual(60);
    expect(key).toMatch(SERVER_KEY);
  });

  it("leaves room for the suffix that keeps two long questions apart", () => {
    const label = "Please describe in detail the biggest challenge in your practice right now";
    const first = questionKey(label, []);
    const second = questionKey(label, [first]);
    expect(second).not.toBe(first);
    expect(second.length).toBeLessThanOrEqual(60);
    expect(second).toMatch(SERVER_KEY);
  });

  it("keeps short keys as they were", () => {
    expect(questionKey("Practice size", [])).toBe("practice_size");
    expect(questionKey("Email", ["email"])).toBe("email_2");
  });
});

describe("fetchAllReplies — every reply, not the first page", () => {
  const reply = (id: number) => ({ id }) as FormSubmission;

  it("pages until the total is reached", async () => {
    const all = Array.from({ length: 250 }, (_, i) => reply(250 - i));
    const offsets: number[] = [];
    const rows = await fetchAllReplies(7, null, async (_id, offset = 0) => {
      offsets.push(offset);
      return { total: all.length, submissions: all.slice(offset, offset + 100) };
    });
    expect(rows).toHaveLength(250);
    expect(offsets).toEqual([0, 100, 200]);
  });

  it("drops a reply a new arrival pushed onto the next page twice", async () => {
    const pages = [
      { total: 3, submissions: [reply(3), reply(2)] },
      { total: 3, submissions: [reply(2), reply(1)] },
    ];
    let call = 0;
    const rows = await fetchAllReplies(7, null, async () => pages[call++]);
    expect(rows.map((row) => row.id)).toEqual([3, 2, 1]);
  });

  it("passes the since filter through", async () => {
    let seen: number | null | undefined;
    await fetchAllReplies(7, 30, async (_id, _offset, sinceDays) => {
      seen = sinceDays;
      return { total: 0, submissions: [] };
    });
    expect(seen).toBe(30);
  });
});
