import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the service-role key.
 *
 * This bypasses row-level security entirely, so every query made with it must
 * scope by user_id explicitly. RLS is not a backstop here — it is off.
 *
 * Importing this into a client component would ship the service-role key to
 * every visitor, so it deliberately reads a non-`NEXT_PUBLIC_` variable, which
 * is undefined in the browser bundle and fails loudly rather than silently
 * shipping.
 */
export function adminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase server credentials are not configured.");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
