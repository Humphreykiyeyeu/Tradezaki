"use client";

import { isCloudConfigured, supabase } from "@/lib/supabase";

/**
 * Exchanges a Deriv session for a Tradezaki (Supabase) session.
 *
 * Called once after Deriv OAuth. Cloud features need a stable user identity;
 * manual trading does not, so a failure here is reported and tolerated rather
 * than blocking the app.
 */
export async function signInWithDeriv(creds: {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isCloudConfigured) {
    return { ok: false, error: "Cloud features aren't set up on this deployment." };
  }

  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(creds),
  });

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
