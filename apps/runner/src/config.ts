import { loadKey } from "@tradezaki/core/node";

/**
 * Runner configuration.
 *
 * Everything is validated at boot and the process refuses to start if anything
 * is missing. A trading service that comes up half-configured and discovers it
 * an hour later — mid-strategy, holding open contracts — is worse than one that
 * never came up.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is not set. The runner cannot start without it.`);
  }
  return v;
}

export const config = {
  supabaseUrl: required("SUPABASE_URL"),

  /**
   * The service-role key bypasses row-level security, which is exactly why the
   * runner needs it and exactly why it must never reach a browser. It belongs
   * only in this process's environment.
   */
  supabaseServiceKey: required("SUPABASE_SERVICE_ROLE_KEY"),

  derivAppId: process.env.DERIV_APP_ID ?? "340ceNJpp5bdPFZLJxcew",

  /** AES-256 key for the credential vault. Never logged, never persisted. */
  tokenKey: loadKey(process.env.DERIV_TOKEN_KEY),

  /** How often to look for bots that were started or stopped from the web app. */
  pollMs: Number(process.env.RUNNER_POLL_MS ?? 5000),

  /**
   * Heartbeat interval. The web app treats a bot whose heartbeat is stale as
   * crashed, so this must be comfortably shorter than that threshold.
   */
  heartbeatMs: Number(process.env.RUNNER_HEARTBEAT_MS ?? 15000),

  /**
   * Cap on bots per process. Each holds an open WebSocket, and an unbounded
   * count would degrade every bot at once rather than refusing the last one.
   */
  maxBots: Number(process.env.RUNNER_MAX_BOTS ?? 50),

  /** Identifies this process in the bots table when several runners exist. */
  instanceId: process.env.RUNNER_INSTANCE_ID ?? `runner-${process.pid}`,
} as const;

export type Config = typeof config;
