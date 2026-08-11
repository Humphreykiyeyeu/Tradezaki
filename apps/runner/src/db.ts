import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

/**
 * Supabase client using the service-role key.
 *
 * This bypasses row-level security, so every query in the runner must scope by
 * user_id explicitly. RLS is not a safety net here — it is switched off for
 * this connection, and a forgotten `.eq("user_id", …)` reads everyone's data.
 */
export const db = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
