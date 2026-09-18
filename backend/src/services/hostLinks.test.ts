import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../db/pool", () => ({ pool: { query } }));
vi.mock("../config/env", () => ({ env: { publicSiteUrl: "https://site.test" } }));
vi.mock("./memberProfile", () => ({ DEFAULT_TIMEZONE: "America/New_York" }));

import { hashToken } from "../auth/tokens";
import {
  HOST_LINK_TTL_SECONDS,
  buildHostLinkUrl,
  createHostLink,
  splitHostName,
} from "./hostLinks";

/** What the fake database holds; each test arranges it and the mock reads it. */
let state: {
  community: Record<string, unknown> | null;
  /** The member already holding the admin's address, if any. */
  existingMember: { id: number; status: string } | null;
};

beforeEach(() => {
  state = {
    community: { id: 3, slug: "the-lounge", published: true, live_room_enabled: true },
    existingMember: null,
  };
  query.mockReset();
  query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM communities")) return { rows: state.community ? [state.community] : [] };
    if (sql.includes("INSERT INTO members")) {
      // ON CONFLICT DO NOTHING returns no row when the address is taken.
      return { rows: state.existingMember ? [] : [{ id: 41, status: "active" }] };
    }
    if (sql.includes("FROM members")) {
      return { rows: state.existingMember ? [state.existingMember] : [] };
    }
    return { rows: [], rowCount: 1 };
  });
});

const input = { adminId: 1, adminEmail: "Yvette@Example.com", adminName: "Yvette Boss", communityId: 3 };

/** The [sql, params] of the first statement containing `fragment`. */
function call(fragment: string): [string, unknown[]] {
  const found = query.mock.calls.find(([sql]) => String(sql).includes(fragment));
  if (!found) throw new Error(`no statement containing ${fragment}`);
  return [String(found[0]), (found[1] ?? []) as unknown[]];
}

describe("splitHostName", () => {
  it("takes the first word as the first name and the rest as the last", () => {
    expect(splitHostName("Yvette Boss", "y@x.com")).toEqual({ firstName: "Yvette", lastName: "Boss" });
    expect(splitHostName("  Mary  Anne Smith ", "m@x.com")).toEqual({
      firstName: "Mary",
      lastName: "Anne Smith",
    });
    expect(splitHostName("Cher", "c@x.com")).toEqual({ firstName: "Cher", lastName: "" });
  });

  it("falls back to the local part of the address when there is no name", () => {
    expect(splitHostName("   ", "coach@x.com")).toEqual({ firstName: "coach", lastName: "" });
  });
});

describe("buildHostLinkUrl", () => {
  it("points at the public site's host-link page and carries the room as a path", () => {
    const url = new URL(buildHostLinkUrl("https://site.test", "a_b-c", "the-lounge"));
    expect(url.origin + url.pathname).toBe("https://site.test/host-link");
    expect(url.searchParams.get("token")).toBe("a_b-c");
    expect(url.searchParams.get("next")).toBe("/community/the-lounge/live");
  });

  it("escapes both values rather than trusting them", () => {
    expect(buildHostLinkUrl("https://site.test", "a&b", "x y")).toBe(
      "https://site.test/host-link?token=a%26b&next=%2Fcommunity%2Fx%20y%2Flive"
    );
  });
});

describe("createHostLink", () => {
  it("refuses a community that does not exist", async () => {
    state.community = null;
    await expect(createHostLink(input)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a room that is switched off, before touching any member", async () => {
    state.community = { ...state.community, live_room_enabled: false };
    await expect(createHostLink(input)).rejects.toMatchObject({ status: 400 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("refuses an unpublished community, which the member side would 404", async () => {
    state.community = { ...state.community, published: false };
    await expect(createHostLink(input)).rejects.toMatchObject({ status: 400 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("creates a verified, passwordless member for an admin who has none", async () => {
    const link = await createHostLink(input);
    expect(link.memberId).toBe(41);

    const [sql, params] = call("INSERT INTO members");
    expect(sql).toContain("email_verified_at");
    expect(sql).toContain("ON CONFLICT (email) DO NOTHING");
    expect(sql).not.toContain("password_hash");
    expect(params).toEqual(["Yvette@Example.com", "Yvette Boss", "Yvette", "Boss", "America/New_York"]);
  });

  it("uses the member already holding the address", async () => {
    state.existingMember = { id: 9, status: "active" };
    const link = await createHostLink(input);
    expect(link.memberId).toBe(9);
    expect(call("INSERT INTO community_memberships")[1].slice(0, 2)).toEqual([3, 9]);
  });

  it.each(["suspended", "deleted"])("refuses a %s member account and mints nothing", async (status) => {
    state.existingMember = { id: 9, status };
    await expect(createHostLink(input)).rejects.toMatchObject({ status: 400 });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("member_magic_links"))).toBe(false);
  });

  it("makes her a host without downgrading a role the room already treats as one", async () => {
    await createHostLink(input);
    const [sql, params] = call("INSERT INTO community_memberships");
    expect(params[2]).toBe("moderator");
    expect(params[3]).toEqual(["host", "owner", "moderator"]);
    expect(sql).toContain("THEN community_memberships.role");
    // Manual is what opens the door of a sold community; see services/access.ts.
    expect(sql).toContain("source = 'manual'");
    expect(sql).toContain("COALESCE(community_memberships.guidelines_accepted_at, now())");
  });

  it("retires earlier host links only, and stores the hash rather than the token", async () => {
    const link = await createHostLink(input);
    const raw = new URL(link.url).searchParams.get("token") ?? "";
    expect(raw.length).toBeGreaterThan(20);

    const [retire] = call("UPDATE member_magic_links");
    expect(retire).toContain("purpose = 'host'");

    const [insert, params] = call("INSERT INTO member_magic_links");
    expect(insert).toContain("'host'");
    expect(params[0]).toBe(41);
    expect(params[1]).toBe(hashToken(raw));
    expect(JSON.stringify(query.mock.calls.map(([, p]) => p))).not.toContain(raw);
  });

  it("expires in two minutes and lands her in the room", async () => {
    const before = Date.now();
    const link = await createHostLink(input);
    expect(link.expiresInSeconds).toBe(HOST_LINK_TTL_SECONDS);
    expect(HOST_LINK_TTL_SECONDS).toBe(120);
    expect(new URL(link.url).searchParams.get("next")).toBe("/community/the-lounge/live");

    const expiresAt = call("INSERT INTO member_magic_links")[1][2] as Date;
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(120_000);
    expect(expiresAt.getTime() - before).toBeLessThan(125_000);
  });
});
