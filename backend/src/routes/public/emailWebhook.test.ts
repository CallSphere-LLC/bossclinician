import { execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import express, {
  type NextFunction,
  type Request as ExpressRequest,
  type Response as ExpressResponse,
} from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The SES/SNS endpoint makes outbound requests because a body told it to: one
 * for the signing certificate the notification names, one to confirm a
 * subscription. Those are request-forgery sinks on an unauthenticated route,
 * on a host whose environment holds AWS credentials, and the certificate one
 * also decides whose signature is believed.
 *
 * What these tests pin: nothing is fetched from anywhere but the configured
 * topic's own SNS endpoint, however the body spells the URL; nothing is acted
 * on before the topic and the signature both check out; and a SubscribeURL or
 * UnsubscribeURL in the body is never requested at all.
 */

const TOPIC = "arn:aws:sns:us-east-1:123456789012:bossclinician-ses-events";
const SNS_ORIGIN = "https://sns.us-east-1.amazonaws.com";
const METADATA = "http://169.254.169.254/latest/meta-data/iam/security-credentials/";

vi.mock("../../config/env", () => ({ env: { ses: { snsTopicArn: "" } } }));
vi.mock("../../db/pool", () => ({
  pool: { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) },
}));
vi.mock("../../email/provider", () => ({
  providerSettings: vi.fn(async () => ({ webhookSecret: "" })),
  suppress: vi.fn(async () => undefined),
}));

import { env } from "../../config/env";
import { providerSettings, suppress } from "../../email/provider";
import {
  emailWebhookRouter,
  snsCertificateUrl,
  snsConfirmationUrl,
  snsEndpoint,
} from "./emailWebhook";

const fetchMock = vi.fn(async (input: URL | string, _init?: RequestInit): Promise<Response> => {
  void input;
  return new Response("");
});

/** Stands in for the key and certificate SNS signs with. */
let snsKey: string;
let snsCert: string;
/** Somebody else's key: a valid signature, from the wrong party. */
const attacker = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

let server: http.Server;
let port: number;

const SIGNED_FIELDS: Record<string, string[]> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
  UnsubscribeConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
};

/** Signs exactly as SNS does: each present field's name and value, one per line. */
function signed(
  message: Record<string, string>,
  { key = snsKey as crypto.KeyLike, version = "1" }: { key?: crypto.KeyLike; version?: string } = {}
): string {
  const canonical = SIGNED_FIELDS[message.Type]
    .filter((field) => message[field] !== undefined)
    .map((field) => `${field}\n${message[field]}\n`)
    .join("");
  const signature = crypto
    .sign(version === "2" ? "sha256" : "sha1", Buffer.from(canonical, "utf8"), key)
    .toString("base64");
  return JSON.stringify({ ...message, SignatureVersion: version, Signature: signature });
}

/** A distinct certificate name per test, so the module's certificate cache cannot carry between them. */
let certCounter = 0;
const nextCertUrl = (): string =>
  `${SNS_ORIGIN}/SimpleNotificationService-${(certCounter += 1).toString(16).padStart(32, "0")}.pem`;

function notification(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    Type: "Notification",
    MessageId: `n-${certCounter}`,
    TopicArn: TOPIC,
    Timestamp: "2026-09-14T12:00:00.000Z",
    Message: JSON.stringify({
      eventType: "Delivery",
      mail: { messageId: "ses-1", destination: ["reader@example.com"] },
      delivery: { timestamp: "2026-09-14T12:00:00.000Z" },
    }),
    SigningCertURL: nextCertUrl(),
    UnsubscribeURL: METADATA,
    ...overrides,
  };
}

function confirmation(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    Type: "SubscriptionConfirmation",
    MessageId: `c-${certCounter}`,
    TopicArn: TOPIC,
    Token: "2336412f37fb687f5d51e6e2425c464de257ebb4bd",
    Timestamp: "2026-09-14T12:00:00.000Z",
    Message: "You have chosen to subscribe to the topic.",
    SubscribeURL: METADATA,
    SigningCertURL: nextCertUrl(),
    ...overrides,
  };
}

function post(
  pathname: string,
  body: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port, path: pathname, method: "POST", headers: { "content-type": "text/plain; charset=UTF-8", ...headers } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: response.statusCode ?? 0, json: text ? JSON.parse(text) : {} });
        });
      }
    );
    request.on("error", reject);
    request.end(body);
  });
}

const fetchedUrls = (): URL[] => fetchMock.mock.calls.map(([input]) => new URL(String(input)));

beforeAll(async () => {
  // Node can sign and verify but cannot issue an X.509 certificate, and the
  // endpoint insists on one, so openssl makes a throwaway pair for the run.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-sns-"));
  try {
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=sns.amazonaws.com",
        "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem")],
      { stdio: "ignore" }
    );
    snsKey = fs.readFileSync(path.join(dir, "key.pem"), "utf8");
    snsCert = fs.readFileSync(path.join(dir, "cert.pem"), "utf8");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  vi.stubGlobal("fetch", fetchMock);

  const app = express();
  app.use("/api", emailWebhookRouter);
  app.use((err: unknown, _req: ExpressRequest, res: ExpressResponse, _next: NextFunction) => {
    res.status(500).json({ error: String(err) });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  env.ses.snsTopicArn = TOPIC;
  fetchMock.mockClear();
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.origin === SNS_ORIGIN && url.pathname.endsWith(".pem")) return new Response(snsCert);
    if (url.origin === SNS_ORIGIN && url.searchParams.get("Action") === "ConfirmSubscription") {
      return new Response("<ConfirmSubscriptionResponse/>");
    }
    // Anywhere else is somewhere this endpoint must never reach. Answer the way
    // an attacker's server would, so a test that did reach it could not pass by accident.
    return new Response("-----BEGIN CERTIFICATE-----\nattacker\n-----END CERTIFICATE-----");
  });
  vi.mocked(suppress).mockClear();
});

describe("SNS endpoint derivation", () => {
  it("derives the regional endpoint from the configured topic, China included", () => {
    expect(snsEndpoint(TOPIC)).toEqual({ topicArn: TOPIC, host: "sns.us-east-1.amazonaws.com", origin: SNS_ORIGIN });
    expect(snsEndpoint("arn:aws-cn:sns:cn-north-1:123456789012:t")?.host).toBe("sns.cn-north-1.amazonaws.com.cn");
    expect(snsEndpoint("arn:aws-us-gov:sns:us-gov-west-1:123456789012:t")?.host).toBe("sns.us-gov-west-1.amazonaws.com");
  });

  it("has no endpoint for an unset or malformed topic", () => {
    for (const arn of ["", "arn:aws:sqs:us-east-1:123456789012:t", "arn:aws:sns:us-east-1.evil.example:123456789012:t", "arn:aws:sns:us-east-1:123:t"]) {
      expect(snsEndpoint(arn)).toBeNull();
    }
  });

  it("accepts a certificate URL only on the topic's own endpoint, and rebuilds it there", () => {
    const endpoint = snsEndpoint(TOPIC)!;
    const good = snsCertificateUrl(`${SNS_ORIGIN}/SimpleNotificationService-abc123.pem?x=1#y`, endpoint);
    expect(good?.href).toBe(`${SNS_ORIGIN}/SimpleNotificationService-abc123.pem`);

    for (const forged of [
      "https://evil.example/SimpleNotificationService-abc.pem",
      "http://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem",
      "https://sns.us-east-1.amazonaws.com.evil.example/SimpleNotificationService-abc.pem",
      "https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc.pem",
      "https://attacker@sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem",
      "https://sns.us-east-1.amazonaws.com:8443/SimpleNotificationService-abc.pem",
      "https://sns.us-east-1.amazonaws.com/redirect/SimpleNotificationService-abc.pem",
      "https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe",
      "https://169.254.169.254/latest/meta-data/x.pem",
      METADATA,
      "not a url",
      "",
    ]) {
      expect(snsCertificateUrl(forged, endpoint), forged).toBeNull();
    }
  });

  it("builds the confirmation on the configured endpoint from the topic and token", () => {
    const url = snsConfirmationUrl(snsEndpoint(TOPIC)!, "tok&Action=Unsubscribe");
    expect(url.origin).toBe(SNS_ORIGIN);
    expect(url.searchParams.get("Action")).toBe("ConfirmSubscription");
    expect(url.searchParams.get("TopicArn")).toBe(TOPIC);
    // A token cannot smuggle a second parameter in.
    expect(url.searchParams.get("Token")).toBe("tok&Action=Unsubscribe");
    expect(url.searchParams.getAll("Action")).toEqual(["ConfirmSubscription"]);
  });
});

describe("POST /api/email/webhook/ses", () => {
  it("refuses everything while no topic is configured, before reading the body", async () => {
    env.ses.snsTopicArn = "";
    const response = await post("/api/email/webhook/ses", signed(confirmation()));
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a correctly signed message from somebody else's topic without fetching anything", async () => {
    const response = await post(
      "/api/email/webhook/ses",
      signed(confirmation({ TopicArn: "arn:aws:sns:us-east-1:999999999999:attacker-topic" }))
    );
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never fetches a certificate from a forged or foreign URL", async () => {
    for (const SigningCertURL of [
      "https://evil.example/SimpleNotificationService-abc.pem",
      "http://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem",
      "https://sns.us-east-1.amazonaws.com.evil.example/SimpleNotificationService-abc.pem",
      "https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-abc.pem",
      "https://sns.us-east-1.amazonaws.com@evil.example/SimpleNotificationService-abc.pem",
      METADATA,
    ]) {
      const response = await post("/api/email/webhook/ses", signed(confirmation({ SigningCertURL })));
      expect(response.status, SigningCertURL).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(suppress).not.toHaveBeenCalled();
  });

  it("refuses a signature SNS's certificate does not verify, and confirms nothing", async () => {
    const response = await post(
      "/api/email/webhook/ses",
      signed(confirmation(), { key: attacker.privateKey })
    );
    expect(response.status).toBe(401);
    // Only the certificate was fetched, from SNS, with redirects refused.
    expect(fetchedUrls().map((url) => url.origin)).toEqual([SNS_ORIGIN]);
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe("error");
  });

  it("refuses a tampered body even when the signature was genuine", async () => {
    const message = JSON.parse(signed(notification())) as Record<string, string>;
    message.Message = JSON.stringify({
      eventType: "Bounce",
      mail: { messageId: "ses-1" },
      bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: "owner@example.com" }] },
    });
    const response = await post("/api/email/webhook/ses", JSON.stringify(message));
    expect(response.status).toBe(401);
    expect(suppress).not.toHaveBeenCalled();
  });

  it("refuses a signature version SNS does not define", async () => {
    const response = await post("/api/email/webhook/ses", signed(notification(), { version: "3" }));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when the certificate cannot be fetched", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("gone", { status: 404 }));
    const response = await post("/api/email/webhook/ses", signed(notification()));
    expect(response.status).toBe(401);
  });

  it("confirms a genuine subscription on the configured endpoint, ignoring the SubscribeURL it was sent", async () => {
    const response = await post("/api/email/webhook/ses", signed(confirmation()));
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ confirmed: true });

    const urls = fetchedUrls();
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.origin === SNS_ORIGIN)).toBe(true);
    expect(urls.some((url) => url.hostname === "169.254.169.254")).toBe(false);
    const confirm = urls[1];
    expect(confirm.searchParams.get("Action")).toBe("ConfirmSubscription");
    expect(confirm.searchParams.get("TopicArn")).toBe(TOPIC);
    expect(confirm.searchParams.get("Token")).toBe("2336412f37fb687f5d51e6e2425c464de257ebb4bd");
    expect(fetchMock.mock.calls.every(([, init]) => init?.redirect === "error")).toBe(true);
  });

  it("acknowledges an unsubscribe confirmation without requesting any of its URLs", async () => {
    const message = confirmation({ Type: "UnsubscribeConfirmation" });
    const response = await post("/api/email/webhook/ses", signed(message));
    expect(response.status).toBe(200);
    expect(fetchedUrls().map((url) => url.href)).toEqual([message.SigningCertURL]);
  });

  it("applies a genuine notification, signature version 2 included", async () => {
    const response = await post("/api/email/webhook/ses", signed(notification(), { version: "2" }));
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ received: 1, outcomes: ["unmatched"] });
    // The UnsubscribeURL every notification carries is never requested.
    expect(fetchedUrls().map((url) => url.origin)).toEqual([SNS_ORIGIN]);
  });
});

describe("POST /api/email/webhook (signed providers)", () => {
  const secret = "webhook-test-secret";
  const svixSecret = `whsec_${Buffer.from(secret).toString("base64")}`;
  const body = JSON.stringify({
    id: "evt-1",
    type: "email.delivered",
    created_at: "2026-09-14T12:00:00.000Z",
    data: { email_id: "e-1", to: "reader@example.com" },
  });
  const hmacHex = (key: string): string => crypto.createHmac("sha256", key).update(body).digest("hex");
  // JSON, as these providers send it: this route's own raw parser takes only
  // that type (app.ts mounts a catch-all one in front of it in the real app).
  const postEvent = (headers: Record<string, string> = {}) =>
    post("/api/email/webhook", body, { "content-type": "application/json", ...headers });

  it("refuses an unsigned post, and one signed with the wrong secret under either scheme", async () => {
    vi.mocked(providerSettings).mockResolvedValue({ webhookSecret: secret } as Awaited<ReturnType<typeof providerSettings>>);
    expect((await postEvent()).status).toBe(401);
    expect((await postEvent({ "x-webhook-signature": hmacHex("wrong") })).status).toBe(401);
    expect(
      (await postEvent({ "svix-id": "msg_1", "svix-timestamp": "1", "svix-signature": "v1,AAAA" })).status
    ).toBe(401);
  });

  it("accepts a correct plain HMAC signature", async () => {
    vi.mocked(providerSettings).mockResolvedValue({ webhookSecret: secret } as Awaited<ReturnType<typeof providerSettings>>);
    const response = await postEvent({ "x-webhook-signature": `sha256=${hmacHex(secret)}` });
    expect(response.status).toBe(200);
  });

  it("accepts a correct Svix signature", async () => {
    vi.mocked(providerSettings).mockResolvedValue({ webhookSecret: svixSecret } as Awaited<ReturnType<typeof providerSettings>>);
    const signature = crypto
      .createHmac("sha256", Buffer.from(secret))
      .update(`msg_1.1757851200.${body}`)
      .digest("base64");
    const response = await postEvent({
      "svix-id": "msg_1",
      "svix-timestamp": "1757851200",
      "svix-signature": `v1,${signature}`,
    });
    expect(response.status).toBe(200);
  });
});
