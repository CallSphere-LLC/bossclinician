import { beforeEach, describe, expect, it, vi } from "vitest";
import { notificationRecipients } from "./notificationRecipients";

/**
 * The notification settings were decoration: the screen saved an address and a
 * switch per kind of news, and every sender read NOTIFY_EMAIL instead. These
 * pin the two things the helper exists to make true — the saved address wins,
 * and a switch that is off means nobody is told.
 */

const readSetting = vi.fn();
vi.mock("./settings", () => ({ readSetting: (...args: unknown[]) => readSetting(...args) }));

const mockEnv = vi.hoisted(() => ({ notifyEmail: "env@example.com" }));
vi.mock("../config/env", () => ({ env: mockEnv }));

const DEFAULTS = { notifyEmail: "", onSale: true, onLead: true, onDispute: true, onJobFailure: true };

beforeEach(() => {
  readSetting.mockReset();
  readSetting.mockResolvedValue({ ...DEFAULTS });
  mockEnv.notifyEmail = "env@example.com";
});

describe("notificationRecipients", () => {
  it("reads the notifications setting", async () => {
    await notificationRecipients("sale");
    expect(readSetting).toHaveBeenCalledWith("notifications");
  });

  it("prefers the address saved in settings over NOTIFY_EMAIL", async () => {
    readSetting.mockResolvedValue({ ...DEFAULTS, notifyEmail: "  yvette@example.com " });
    expect(await notificationRecipients("sale")).toBe("yvette@example.com");
  });

  it("falls back to NOTIFY_EMAIL when the saved address is blank", async () => {
    expect(await notificationRecipients("lead")).toBe("env@example.com");
  });

  it("tells nobody when neither address is set", async () => {
    mockEnv.notifyEmail = "";
    expect(await notificationRecipients("sale")).toBe("");
  });

  it("tells nobody about a kind whose switch is off", async () => {
    readSetting.mockResolvedValue({ ...DEFAULTS, notifyEmail: "yvette@example.com", onSale: false, onDispute: false });
    expect(await notificationRecipients("sale")).toBe("");
    expect(await notificationRecipients("dispute")).toBe("");
    // The other switches are their own.
    expect(await notificationRecipients("lead")).toBe("yvette@example.com");
    expect(await notificationRecipients("jobFailure")).toBe("yvette@example.com");
  });

  it("treats a missing flag as on, so a row saved before the flag existed still notifies", async () => {
    readSetting.mockResolvedValue({ notifyEmail: "yvette@example.com" });
    expect(await notificationRecipients("jobFailure")).toBe("yvette@example.com");
  });

  it("never lets a switch silence an alert", async () => {
    readSetting.mockResolvedValue({ notifyEmail: "", onSale: false, onLead: false, onDispute: false, onJobFailure: false });
    expect(await notificationRecipients("alert")).toBe("env@example.com");
  });

  it("uses NOTIFY_EMAIL, and does not throw, when settings cannot be read", async () => {
    readSetting.mockRejectedValue(new Error("connection refused"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await notificationRecipients("sale")).toBe("env@example.com");
    spy.mockRestore();
  });
});
