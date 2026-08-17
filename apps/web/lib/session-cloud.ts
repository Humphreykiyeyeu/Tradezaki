"use client";

import { isCloudConfigured, supabase } from "@/lib/supabase";

/**
 * Exchanges the Deriv session cookie for a Tradezaki (Supabase) session.
 *
 * Called once after Deriv OAuth. Cloud features need a stable user identity;
 * manual trading does not, so a failure here is reported and tolerated rather
 * than blocking the app.
 */
export async function signInWithDeriv(): Promise<{ ok: boolean; error?: string }> {
  if (!isCloudConfigured) {
    return { ok: false, error: "Cloud features aren't set up on this deployment." };
  }

  // No body: the route reads the Deriv session from the httpOnly cookie. The
  // credential is never in this file's hands to pass along.
  const res = await fetch("/api/auth/session", { method: "POST" });

  const body = await res.json();
  if (!res.ok || !body.tokenHash) {
    return { ok: false, error: body.error ?? "Could not start your Tradezaki session." };
  }

  const { error } = await supabase().auth.verifyOtp({
    token_hash: body.tokenHash,
    type: "magiclink",
  });

  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function currentUserId(): Promise<string | null> {
  if (!isCloudConfigured) return null;
  const { data } = await supabase().auth.getUser();
  return data.user?.id ?? null;
}
