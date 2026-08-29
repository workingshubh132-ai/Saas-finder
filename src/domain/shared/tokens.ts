import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTE_LENGTH = 32;
const VISIBLE_PREFIX_LENGTH = 10;

export interface GeneratedToken {
  /** Shown to the caller exactly once. Never persisted. */
  readonly token: string;
  readonly tokenHash: string;
  /** Safe to display/log — not enough of the secret to reconstruct it. */
  readonly tokenPrefix: string;
}

export function generateToken(): GeneratedToken {
  const token = `vf_${randomBytes(TOKEN_BYTE_LENGTH).toString("base64url")}`;
  return { token, tokenHash: hashToken(token), tokenPrefix: token.slice(0, VISIBLE_PREFIX_LENGTH) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
