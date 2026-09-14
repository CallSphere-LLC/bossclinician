import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two route-level halves of E4 and E5 that the pure tests cannot reach.
 *
 *   E4 — a from-address off the verified sending domain is refused WHEN SAVED,
 *        with a sentence short enough for the console to show as it is, and
 *        nothing is written.
 *   E5 — the "Sending service" field comes back as the transport actually in
 *        use, locked, whatever the stored row says; and saving a transport the
 *        server does not run is refused rather than accepted and ignored.
 */

vi.mock("../../config/env", () => ({
  env: {
    smtp: { host: "email-smtp.us-east-1.amazonaws.com", port: 587, user: "u", pass: "p", from: "Yvette <yvette@bossclinician.callsphere.site>" },
    ses: { transactionalConfigSet: "t", marketingConfigSet: "m", snsTopicArn: "" },
  },
}));
vi.mock("../../db/pool", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("../../email/mailer", () => ({ sendMailStrict: vi.fn() }));
vi.mock("../../email/templates", () => ({ escapeHtml: (s: string) => s }));
vi.mock("../../services/adminAudit", () => ({ recordAdminAction: vi.fn(async () => undefined) }));
vi.mock("../../services/permissions", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const SES_TRANSPORT = {
  key: "ses",
  label: "Amazon SES",
  source: "server",
  locked: true,
  detail: "Set on the server (SMTP_HOST is email-smtp.us-east-1.amazonaws.com), so it can't be changed from this screen — changing it is a server change.",
  choices: [{ value: "ses", label: "Amazon SES (set on the server)" }],
};
vi.mock("../../email/provider", () => ({
  activeTransport: vi.fn(async () => SES_TRANSPORT),
  verifiedSendingDomains: () => ["bossclinician.callsphere.site"],
}));

const writeSetting = vi.fn();
vi.mock("../../services/settings", () => {
  class SettingValidationError extends Error {
    details: unknown;
    constructor(details: unknown) {
      super("invalid");
      this.details = details;
    }
  }
  const definitions = [
    { key: "marketing_email", group: "email", fields: [{ name: "fromEmail", type: "email" }] },
    { key: "email_provider", group: "email", fields: [{ name: "provider", type: "choice" }, { name: "webhookSecret", type: "secret" }] },
  ];
  return {
    SETTING_DEFINITIONS: definitions,
    SettingValidationError,
    readSetting: vi.fn(async () => ({})),
    settingDefinition: (key: string) => definitions.find((d) => d.key === key),
    writeSetting: (...args: unknown[]) => writeSetting(...args),
    settingGroups: vi.fn(async () => [
      {
        key: "email",
        label: "Email",
        description: "",
        settings: [
          {
            key: "email_provider",
            label: "Who delivers your email",
            description: "",
            fields: [
              {
                name: "provider",
                label: "Sending service",
                type: "choice",
                // What the live row held while every message went out through SES.
                value: "smtp",
                choices: [
                  { value: "ses", label: "Amazon SES" },
                  { value: "smtp", label: "Your own mail server" },
                  { value: "resend", label: "Resend" },
                ],
              },
              { name: "webhookSecret", label: "Signing secret", type: "secret", hasValue: false, hint: "" },
            ],
          },
        ],
      },
    ]),
  };
});

let base = "";
let close: () => void = () => undefined;

beforeAll(async () => {
  const { adminSettingsV2Router } = await import("./settingsV2");
  const app = express();
  app.use(express.json());
  app.use("/", adminSettingsV2Router);
  // The shape of the app's own error handler, enough to read status and message.
  app.use((err: { status?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

afterAll(() => close());

beforeEach(() => {
  writeSetting.mockReset();
  writeSetting.mockImplementation(async (_key: string, patch: Record<string, unknown>) => patch);
});

async function put(key: string, body: unknown): Promise<{ status: number; json: { error?: string } }> {
  const res = await fetch(`${base}/${key}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as { error?: string } };
}

describe("PUT /settings-v2/marketing_email (E4)", () => {
  it("refuses a display-only @bossclinician.com sender, says why, and writes nothing", async () => {
    const res = await put("marketing_email", { fromEmail: "yvette@bossclinician.com", fromName: "Yvette" });

    expect(res.status).toBe(400);
    expect(res.json.error).toContain("yvette@bossclinician.com");
    expect(res.json.error).toContain("@bossclinician.callsphere.site");
    // ui/friendly.ts shows a 400 verbatim only up to 200 characters.
    expect((res.json.error ?? "").length).toBeLessThanOrEqual(200);
    expect(writeSetting).not.toHaveBeenCalled();
  });

  it("saves an address on the verified sending domain, and a blank one", async () => {
    expect((await put("marketing_email", { fromEmail: "yvette@bossclinician.callsphere.site" })).status).toBe(200);
    expect((await put("marketing_email", { fromEmail: "" })).status).toBe(200);
    expect(writeSetting).toHaveBeenCalledTimes(2);
  });
});

describe("the Sending service field (E5)", () => {
  it("shows the transport actually in use, locked, not the stale stored value", async () => {
    const res = await fetch(`${base}/groups`);
    const body = (await res.json()) as {
      groups: { settings: { key: string; fields: Record<string, unknown>[] }[] }[];
    };
    const field = body.groups[0].settings[0].fields.find((f) => f.name === "provider");

    expect(field).toMatchObject({ value: "ses", locked: true, source: "server" });
    expect(field?.choices).toEqual(SES_TRANSPORT.choices);
    expect(String(field?.help)).toContain("SMTP_HOST");
  });

  it("refuses to save a transport the server does not run, instead of accepting and ignoring it", async () => {
    const res = await put("email_provider", { provider: "smtp" });

    expect(res.status).toBe(400);
    expect(res.json.error).toContain("Amazon SES");
    expect(writeSetting).not.toHaveBeenCalled();
  });

  it("still saves the signing secret on its own", async () => {
    expect((await put("email_provider", { webhookSecret: "whsec_x" })).status).toBe(200);
  });
});
