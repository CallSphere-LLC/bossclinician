import { beforeAll, describe, expect, it, vi } from "vitest";
import type * as SettingsV2 from "./settingsV2";

/**
 * What a settings save may send back to the browser and into the audit log.
 *
 * `writeSetting` returns the stored row with every key in it, including ones the
 * registry does not declare — `email_provider.apiKey`, the Resend key, is read
 * from there by email/provider.ts. Only the declared fields may leave, and the
 * secret ones only as "[hidden]".
 */

vi.mock("../../config/env", () => ({
  env: { smtp: { host: "", user: "", pass: "", from: "" }, ses: {} },
}));
vi.mock("../../db/pool", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("../../email/mailer", () => ({ sendMailStrict: vi.fn() }));
vi.mock("../../email/templates", () => ({ escapeHtml: (s: string) => s }));
vi.mock("../../services/adminAudit", () => ({ recordAdminAction: vi.fn(async () => undefined) }));
vi.mock("../../services/permissions", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../email/provider", () => ({
  activeTransport: vi.fn(),
  verifiedSendingDomains: () => [],
}));
vi.mock("../../services/sendingIdentity", () => ({
  reviewSendingIdentity: vi.fn(),
  sendingAddressProblem: vi.fn(),
}));
vi.mock("../../services/settings", () => ({
  SETTING_DEFINITIONS: [],
  SettingValidationError: class extends Error {},
  readSetting: vi.fn(),
  settingDefinition: vi.fn(),
  settingGroups: vi.fn(),
  writeSetting: vi.fn(),
}));

let redactSettingValue: typeof SettingsV2.redactSettingValue;

beforeAll(async () => {
  ({ redactSettingValue } = await import("./settingsV2"));
});

const EMAIL_PROVIDER_FIELDS = [
  { name: "provider", type: "choice" },
  { name: "webhookSecret", type: "secret" },
];

describe("redactSettingValue", () => {
  it("drops a credential the row holds but the registry does not declare", () => {
    expect(
      redactSettingValue(EMAIL_PROVIDER_FIELDS, {
        provider: "resend",
        webhookSecret: "whsec_SECRET",
        apiKey: "re_LIVE_SECRET",
      })
    ).toEqual({ provider: "resend", webhookSecret: "[hidden]" });
  });

  it("hides every field of a row flagged secret", () => {
    expect(
      redactSettingValue(EMAIL_PROVIDER_FIELDS, { provider: "resend", webhookSecret: "" }, true)
    ).toEqual({ provider: "[hidden]", webhookSecret: "[hidden]" });
  });

  it("leaves a field the value does not carry absent rather than inventing it", () => {
    expect(redactSettingValue(EMAIL_PROVIDER_FIELDS, { provider: "ses" })).toEqual({
      provider: "ses",
    });
  });
});
