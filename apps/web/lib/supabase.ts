"use client";

import { createClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client.
 *
 * Uses the publishable key, which is public by design — row-level security is
 * what keeps one user's data away from another, not the secrecy of this string.
 * Every table the browser touches has an RLS policy scoped to auth.uid();
 * `deriv_credentials` deliberately has none, so this client cannot read tokens
 * at all.
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true } }
);
