import crypto from "crypto";
import jwt from "jsonwebtoken";
import { JwtPayload as AppJwtPayload } from "../types";
import { adminTokenSecret } from "../auth/secrets";

export function signToken(payload: AppJwtPayload): string {
  return jwt.sign(payload, adminTokenSecret(), {
    expiresIn: 5 * 60,
    algorithm: "HS256",
    jwtid: crypto.randomUUID(),
  });
}

/**
 * Verifies an admin token.
 *
 * The `role` check is not redundant with the signature check above it. Member
 * tokens are signed with a different key (auth/secrets.ts), so one cannot reach
 * this function with a valid signature today — but this is the function that
 * decides whether a request is an administrator, and it should be the thing
 * that says so rather than inheriting the answer from key management two
 * modules away. A token with no `role` claim is not an admin token, whatever
 * signed it.
 */
export function verifyToken(token: string, ignoreExpiration = false): AppJwtPayload {
  const decoded = jwt.verify(token, adminTokenSecret(), {
    algorithms: ["HS256"],
    ignoreExpiration,
  }) as unknown as AppJwtPayload;

  if (!decoded || typeof decoded.role !== "string" || decoded.role.length === 0) {
    throw new jwt.JsonWebTokenError("Token is not an administrator token");
  }

  return decoded;
}
