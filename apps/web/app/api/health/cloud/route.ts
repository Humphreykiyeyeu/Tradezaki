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

const fingerprint = (v: string) => createHash("sha256").update(v).digest("hex").slice(0, 12);

/** Absent and present-but-blank are the same failure; don't distinguish them. */
function describe(value: string | undefined) {
  if (!value) return { set: false as const };
  return { set: true as const, fingerprint: fingerprint(value) };
}

export function GET() {
  return NextResponse.json({
    // Not a secret: it is in the browser bundle already. Included because a
    // deployment pointed at the wrong Supabase project produces the same
    // symptom as a bad key — a runner that never sees the bot row.
    supabaseUrl:
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    derivTokenKey: describe(process.env.DERIV_TOKEN_KEY),
    supabaseServiceKey: describe(process.env.SUPABASE_SERVICE_ROLE_KEY),
    supabaseAnonKey: describe(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  });
}
