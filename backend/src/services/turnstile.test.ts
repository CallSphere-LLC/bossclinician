import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readSetting = vi.fn();
vi.mock("./settings", () => ({ readSetting: (...args: unknown[]) => readSetting(...args) }));

import {
  CAPTCHA_FAILED_BODY,
  passesLeadCaptcha,
  publicRemoteIp,
  turnstileConfig,
  turnstileRequired,
  verifyTurnstile,
} from "./turnstile";
import { leadSchema } from "../validation/schemas";

/**
 * form_settings offered Turnstile, the public endpoint published its site key,
 * and nothing ever verified a token. These pin the server half: when the check
 * applies, that only Cloudflare's explicit yes lets a lead through, and that it
 * fails closed when Cloudflare cannot be reached.
 */

const ON = { spamProtection: "turnstile", turnstileSiteKey: "0x4AAA-site", turnstileSecret: "0x4AAA-secret" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  readSetting.mockReset();
  readSetting.mockResolvedValue({ ...ON });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("verifyTurnstile", () => {
  it("is true only on Cloudflare's success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    expect(await verifyTurnstile("tok", "sec")).toBe(true);
  });

  it("is false when Cloudflare rejects the token", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, "error-codes": ["invalid-input-response"] }));
    expect(await verifyTurnstile("tok", "sec")).toBe(false);
  });

  it("is false on a truthy-but-not-true success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: "true" }));
    expect(await verifyTurnstile("tok", "sec")).toBe(false);
  });

  it("is false on a non-200", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue(jsonResponse({ success: true }, 500));
    expect(await verifyTurnstile("tok", "sec")).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("fails closed and warns when Cloudflare is unreachable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await verifyTurnstile("tok", "sec")).toBe(false);
    expect(warn.mock.calls[0][0]).toMatch(/unreachable/);
  });

  it("fails closed on a timeout abort", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new DOMException("This operation was aborted", "AbortError"));
    expect(await verifyTurnstile("tok", "sec")).toBe(false);
  });

  it("is false on an unreadable body", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    expect(await verifyTurnstile("tok", "sec")).toBe(false);
  });

  it("posts form-encoded secret, response and remoteip with an abort signal", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    await verifyTurnstile("tok", "sec", "203.0.113.9");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = new URLSearchParams(String(init.body));
    expect(body.get("secret")).toBe("sec");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("203.0.113.9");
  });

  it("omits remoteip when none is given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    await verifyTurnstile("tok", "sec");
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1].body)).has("remoteip")).toBe(false);
  });

  it("does not call Cloudflare without a token or secret", async () => {
    expect(await verifyTurnstile("", "sec")).toBe(false);
    expect(await verifyTurnstile("tok", "")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("turnstileRequired", () => {
  const config = turnstileConfig(ON);

  it("applies to the contact form when switched on with both keys", () => {
    expect(turnstileRequired(config, "contact")).toBe(true);
  });

  it("does not apply to other lead sources", () => {
    for (const source of ["apply", "work-with-me", "income-calculator"]) {
      expect(turnstileRequired(config, source)).toBe(false);
    }
  });

  it("does not apply in honeypot mode", () => {
    expect(turnstileRequired(turnstileConfig({ ...ON, spamProtection: "honeypot" }), "contact")).toBe(false);
  });

  it("does not apply without a site key or without a secret", () => {
    expect(turnstileRequired(turnstileConfig({ ...ON, turnstileSiteKey: "  " }), "contact")).toBe(false);
    expect(turnstileRequired(turnstileConfig({ ...ON, turnstileSecret: "" }), "contact")).toBe(false);
    expect(turnstileRequired(turnstileConfig({}), "contact")).toBe(false);
  });
});

describe("passesLeadCaptcha", () => {
  it("reads form_settings", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    await passesLeadCaptcha("contact", "tok", undefined);
    expect(readSetting).toHaveBeenCalledWith("form_settings");
  });

  it("lets everything through, without calling Cloudflare, when the check does not apply", async () => {
    readSetting.mockResolvedValue({ spamProtection: "honeypot", turnstileSiteKey: "", turnstileSecret: "" });
    expect(await passesLeadCaptcha("contact", undefined, "203.0.113.9")).toBe(true);
    readSetting.mockResolvedValue({ ...ON });
    expect(await passesLeadCaptcha("apply", undefined, "203.0.113.9")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a contact enquiry with no token", async () => {
    expect(await passesLeadCaptcha("contact", undefined, undefined)).toBe(false);
    expect(await passesLeadCaptcha("contact", "   ", undefined)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifies with the stored secret and the visitor's public address", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));
    expect(await passesLeadCaptcha("contact", "tok", "::ffff:198.51.100.7")).toBe(true);
    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1].body));
    expect(body.get("secret")).toBe("0x4AAA-secret");
    expect(body.get("remoteip")).toBe("198.51.100.7");
  });

  it("refuses when Cloudflare says no", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false }));
    expect(await passesLeadCaptcha("contact", "tok", undefined)).toBe(false);
  });
});

describe("publicRemoteIp", () => {
  it("drops private, loopback and link-local addresses", () => {
    for (const ip of ["10.42.0.5", "127.0.0.1", "172.16.0.1", "172.31.9.9", "192.168.1.1", "169.254.1.1", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "nonsense", undefined]) {
      expect(publicRemoteIp(ip)).toBeUndefined();
    }
  });

  it("keeps public addresses", () => {
    expect(publicRemoteIp("203.0.113.9")).toBe("203.0.113.9");
    expect(publicRemoteIp("172.32.0.1")).toBe("172.32.0.1");
    expect(publicRemoteIp("2606:4700::1111")).toBe("2606:4700::1111");
  });
});

describe("lead payload", () => {
  it("accepts a turnstileToken and an older client without one", () => {
    const base = { name: "Jane", email: "jane@example.com", source: "contact" };
    expect(leadSchema.parse({ ...base, turnstileToken: "tok" }).turnstileToken).toBe("tok");
    expect(leadSchema.parse(base).turnstileToken).toBeUndefined();
  });
});

describe("CAPTCHA_FAILED_BODY", () => {
  it("carries the code the form branches on and the errorHandler-style error", () => {
    expect(CAPTCHA_FAILED_BODY).toEqual({
      error: "Please complete the security check and try again.",
      code: "captcha_failed",
      message: "Please complete the security check and try again.",
    });
  });
});
