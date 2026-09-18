import crypto from "crypto";
import { env } from "../config/env";

/**
 * Domain-separated signing keys.
 *
 * Admin tokens and member tokens are both HS256 JWTs. Signing them with the
 * same key makes them interchangeable to any verifier that does not check the
 * `aud` claim — and `jsonwebtoken` only checks `aud` when you explicitly pass
 * the `audience` option, which is easy to forget and silent when you do.
 *
 * The concrete escalation that motivated this: a member access token carries no
 * `role` claim, so a verifier that accepts it produces `req.user.role ===
 * undefined`. Every admin route guarded by authentication alone would then let
 * an ordinary customer through.
 *
 * Deriving a distinct key per audience removes the failure mode rather than
 * guarding against it: a member token presented to the admin verifier fails on
 * the signature, before any claim is read. Forgetting an `audience` option
 * somewhere in future cannot reintroduce the hole.
 *
 * HKDF over the configured JWT_SECRET means no new environment variable and no
 * key management: existing deployments keep working, and the admin tokens
 * already in browsers stay valid because the admin key is the base secret
 * unchanged.
 */

const MEMBER_INFO = "bossclinician/member-access-token/v1";
const GOOGLE_STATE_INFO = "bossclinician/google-oauth-state/v1";

function derive(info: string): string {
  // A 32-byte key from the base secret. The salt is empty by design: the base
  // secret is already high-entropy, and a per-process random salt would make
  // tokens unverifiable across restarts and replicas.
  const key = crypto.hkdfSync("sha256", Buffer.from(env.jwtSecret, "utf8"), Buffer.alloc(0), Buffer.from(info, "utf8"), 32);
  return Buffer.from(key).toString("base64");
}

let memberKey: string | null = null;

/** The signing key for member access tokens. Never equal to the admin key. */
export function memberTokenSecret(): string {
  if (memberKey === null) memberKey = derive(MEMBER_INFO);
  return memberKey;
}

let googleStateKey: string | null = null;

/**
 * The HMAC key for the cookie that parks a Google sign-in between /start and
 * /callback (auth/googleOAuth.ts). Its own derivation for the reason at the top
 * of this file: a MAC made with the member or admin key would be a value that
 * means something to two verifiers.
 */
export function googleStateSecret(): string {
  if (googleStateKey === null) googleStateKey = derive(GOOGLE_STATE_INFO);
  return googleStateKey;
}

/** The signing key for admin tokens — the configured secret, unchanged. */
export function adminTokenSecret(): string {
  return env.jwtSecret;
}
