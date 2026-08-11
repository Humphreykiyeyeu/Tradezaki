"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client, created lazily.
 *
 * Lazily on purpose. Creating it at module scope throws "supabaseUrl is
 * required" when the environment variables aren't set, and because Next
 * prerenders pages at build time that turns a *missing optional feature* into a
 * *failed deployment* — which is exactly what happened: every deploy failed
 * while the app kept serving an older build, so the cloud features looked
 * broken rather than absent.
 *
 * Cloud bots are optional. Manual trading must work without them, and the app
 * must build without them.
 *
 * The publishable key is public by design — row-level security is what keeps
 * users apart, not the secrecy of this string. `deriv_credentials` has no
 * select policy at all, so this client cannot read tokens even in principle.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Whether cloud features are available in this deployment. */
export const isCloudConfigured = Boolean(url && key);

export class CloudNotConfiguredError extends Error {
  constructor() {
    super("Cloud features aren't set up on this deployment.");
    this.name = "CloudNotConfiguredError";
  }
}

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!url || !key) throw new CloudNotConfiguredError();
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}
