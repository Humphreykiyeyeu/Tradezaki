import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

/**
 * Reports which cloud secrets this deployment holds, as fingerprints.
 *
 * There are three copies of the configuration — apps/web/.env.local, the
 * runner's .env, and whatever the hosting provider has stored — and only the
 * first two sit on disk where `npm run check:cloud` can read them. The third is
 * the one that breaks things: if the deployed app seals tokens with a different
 * DERIV_TOKEN_KEY than the runner opens them with, login still succeeds (the
 * vault write is caught and warned in api/auth/session), and every cloud bot
 * then fails with "No stored Deriv credentials". Nothing surfaces the cause.
 * This endpoint is what makes that copy checkable from outside.
 *
 * It returns fingerprints, never values. A fingerprint is the first 12 hex
 * characters of SHA-256 — enough to tell two 32-byte random keys apart, and not
 * enough to recover either. Comparing them is the entire point: an operator can
 * see at a glance whether the deployment and the runner agree.
 *
 * Read-only and unauthenticated on purpose, so it works before a session
 * exists — which is exactly when configuration is wrong.
 */

export const dynamic = "force-dynamic";

const fingerprint = (v: string | Buffer) => createHash("sha256").update(v).digest("hex").slice(0, 12);

/** Absent and present-but-blank are the same failure; don't distinguish them. */
function describe(value: string | undefined) {
  if (!value?.trim()) return { set: false as const };
  return { set: true as const, fingerprint: fingerprint(value.trim()) };
}

/**
 * Fingerprints the key material, not the string that encodes it.
 *
 * These are two different questions and only one of them matters. A key pasted
 * with a trailing space is a different *string* but the identical 32 *bytes* —
 * base64 decoding ignores whitespace — so comparing the strings reports a
 * mismatch where encryption would have worked perfectly. What has to agree is
 * what AES is handed.
 */
function describeKey(value: string | undefined) {
  if (!value?.trim()) return { set: false as const };
  const raw = value.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) return { set: true as const, bytes: key.length, invalid: true as const };
  return { set: true as const, bytes: key.length, fingerprint: fingerprint(key) };
}

export function GET() {
  return NextResponse.json({
    // Not a secret: it is in the browser bundle already. Included because a
    // deployment pointed at the wrong Supabase project produces the same
    // symptom as a bad key — a runner that never sees the bot row.
    supabaseUrl:
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    derivTokenKey: describeKey(process.env.DERIV_TOKEN_KEY),
    supabaseServiceKey: describe(process.env.SUPABASE_SERVICE_ROLE_KEY),
    supabaseAnonKey: describe(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  });
}
