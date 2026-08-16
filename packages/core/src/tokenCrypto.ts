import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Envelope encryption for Deriv tokens.
 *
 * AES-256-GCM, chosen because it authenticates as well as encrypts: a tampered
 * ciphertext fails to decrypt rather than yielding plausible garbage that then
 * gets sent to Deriv as a credential.
 *
 * Node-only — it uses `node:crypto` and must never be imported into the browser
 * bundle, which would ship the key handling to every visitor.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const KEY_BYTES = 32;

export interface SealedToken {
  ciphertext: string;
  iv: string;
  tag: string;
}

export class TokenCryptoError extends Error {}

/**
 * Loads the key from a base64 or hex environment variable.
 *
 * Fails loudly on a missing or wrong-length key. The alternative — quietly
 * padding or hashing whatever it was given — would produce a system that looks
 * encrypted while being trivially breakable.
 */
export function loadKey(raw: string | undefined): Buffer {
  if (!raw) {
    throw new TokenCryptoError(
      "DERIV_TOKEN_KEY is not set. Generate one with: openssl rand -base64 32"
    );
  }
  // Trimmed because this value is pasted into hosting dashboards by hand, and a
  // trailing space is invisible there. Base64 decoding already ignores
  // whitespace, but the hex test below does not: a 64-char hex key with a stray
  // space fails the pattern, silently falls through to base64, and yields a
  // different key that still looks plausible. No valid key contains whitespace.
  raw = raw.trim();

  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");

  if (key.length !== KEY_BYTES) {
    throw new TokenCryptoError(
      `DERIV_TOKEN_KEY must decode to 32 bytes, got ${key.length}. Generate one with: openssl rand -base64 32`
    );
  }
  return key;
}

export function seal(plaintext: string, key: Buffer): SealedToken {
  // A fresh IV per encryption. Reusing one under the same key breaks GCM
  // catastrophically — it leaks plaintext relationships and forgery becomes
  // possible — so it is generated here rather than accepted as a parameter.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function open(sealed: SealedToken, key: Buffer): string {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Deliberately opaque: the caller can't distinguish a wrong key from a
    // tampered payload, and shouldn't be able to use this as an oracle.
    throw new TokenCryptoError("Could not decrypt the stored token.");
  }
}

/** Constant-time comparison, for anywhere a token is checked rather than used. */
export function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Redacts a token for logs. Never log the whole thing. */
export function redact(token: string): string {
  if (token.length <= 8) return "…";
  return `${token.slice(0, 4)}…${token.slice(-2)}`;
}
