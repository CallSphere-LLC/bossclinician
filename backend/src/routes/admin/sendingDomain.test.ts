import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminSendingDomainRouter, dmarcPolicy } from "./sendingDomain";

/**
 * The sending-domain check reads DMARC as tags, and knows the configured
 * domain whatever case the from-address was typed in.
 */

vi.mock("../../services/permissions", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../email/provider", () => ({
  marketingSettings: vi.fn(async () => ({ fromEmail: "Yvette@BossClinician.com" })),
}));

const TXT: Record<string, string[][]> = {
  "bossclinician.com": [["v=spf1 include:amazonses.com ~all"]],
  // `sp=` before `p=`: a substring search for "p=" finds "p=none" inside sp=.
  "_dmarc.bossclinician.com": [["v=DMARC1; sp=none; p=reject"]],
};
vi.mock("dns/promises", () => {
  const fail = async () => {
    throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
  };
  const api = {
    resolveTxt: async (host: string) => {
      if (TXT[host]) return TXT[host];
      return fail();
    },
    resolveCname: fail,
    resolveMx: fail,
  };
  return { default: api, ...api };
});

describe("dmarcPolicy", () => {
  it("reads the p tag, not the p= inside sp=", () => {
    expect(dmarcPolicy("v=DMARC1; sp=none; p=reject")).toBe("reject");
    expect(dmarcPolicy("v=DMARC1; p=quarantine; rua=mailto:d@x.com")).toBe("quarantine");
    expect(dmarcPolicy("v=DMARC1;p=None")).toBe("none");
    expect(dmarcPolicy("v=DMARC1; rua=mailto:d@x.com")).toBe("");
  });
});

describe("GET /api/admin/sending-domain", () => {
  let base = "";
  let server: ReturnType<ReturnType<typeof express>["listen"]>;

  beforeAll(async () => {
    const app = express();
    app.use("/api/admin/sending-domain", adminSendingDomainRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("checks the configured domain in lower case and reports an enforcing DMARC", async () => {
    const res = await fetch(`${base}/api/admin/sending-domain`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      domain: string;
      isCurrent: boolean;
      checks: { name: string; status: string }[];
    };
    expect(body.domain).toBe("bossclinician.com");
    const dmarc = body.checks.find((check) => check.name === "DMARC");
    expect(dmarc?.status).toBe("pass");
  });

  it("recognises the configured domain when it is typed in lower case", async () => {
    const res = await fetch(`${base}/api/admin/sending-domain?domain=bossclinician.com`);
    const body = (await res.json()) as { isCurrent: boolean };
    expect(body.isCurrent).toBe(true);
  });
});
