"use client";

import type { RiskGuardianConfig, Strategy } from "@tradezaki/core";
import { supabase } from "@/lib/supabase";

export { isCloudConfigured, CloudNotConfiguredError } from "@/lib/supabase";

/**
 * Cloud bot storage.
 *
 * Every call goes through the browser client under row-level security, so the
 * database enforces ownership rather than this file being trusted to. There is
 * deliberately no server route for these — a route with the service-role key
 * would have to re-implement the ownership checks RLS already does correctly.
 */

export interface SavedStrategy {
  id: string;
  name: string;
  definition: Strategy;
  source: string;
  updated_at: string;
}

export interface CloudBot {
  id: string;
  name: string;
  strategy_id: string;
  deriv_account_id: string;
  status: "stopped" | "starting" | "running" | "stopping" | "error";
  status_detail: string | null;
  last_heartbeat: string | null;
  started_at: string | null;
}

export interface BotEvent {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
  created_at: string;
}

/**
 * Risk limits, per account, in the database rather than the browser.
 *
 * They used to live only in localStorage, which was fine while every bot ran in
 * a tab. It stopped being fine the moment bots moved to a server: the runner
 * reads risk_configs, found nothing there, and fell back to a config with every
 * limit switched off — so an unattended bot on real money had no ceiling at all,
 * however carefully the limits had been set on screen.
 *
 * PLAN.md §7 is explicit that these have to be enforced server-side to be worth
 * anything. This is where that starts.
 */
export async function loadRiskConfig(
  derivAccountId: string
): Promise<RiskGuardianConfig | null> {
  const { data: auth } = await supabase().auth.getUser();
  if (!auth.user) return null;

  const { data, error } = await supabase()
    .from("risk_configs")
    .select("enabled, daily_loss_limit, max_consecutive_losses, cooldown_seconds, max_stake_percent_of_balance")
    .eq("deriv_account_id", derivAccountId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    enabled: data.enabled,
    dailyLossLimit: Number(data.daily_loss_limit),
    maxConsecutiveLosses: data.max_consecutive_losses,
    cooldownSeconds: data.cooldown_seconds,
    maxStakePercentOfBalance: Number(data.max_stake_percent_of_balance),
  };
}

export async function saveRiskConfig(
  derivAccountId: string,
  config: RiskGuardianConfig
): Promise<void> {
  const { data: auth } = await supabase().auth.getUser();
  if (!auth.user) throw new Error("Sign in to save risk limits.");

  const { error } = await supabase().from("risk_configs").upsert(
    {
      user_id: auth.user.id,
      deriv_account_id: derivAccountId,
      enabled: config.enabled,
      daily_loss_limit: config.dailyLossLimit,
      max_consecutive_losses: config.maxConsecutiveLosses,
      cooldown_seconds: config.cooldownSeconds,
      max_stake_percent_of_balance: config.maxStakePercentOfBalance,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,deriv_account_id" }
  );

  if (error) throw new Error(error.message);
}

export async function listStrategies(): Promise<SavedStrategy[]> {
  const { data, error } = await supabase().from("strategies")
    .select("id, name, definition, source, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SavedStrategy[];
}

export async function saveStrategy(
  strategy: Strategy,
  source: "builder" | "dbot_xml",
  existingId?: string
): Promise<string> {
  const { data: auth } = await supabase().auth.getUser();
  if (!auth.user) throw new Error("Sign in to save strategies.");

  const row = {
    user_id: auth.user.id,
    name: strategy.name,
    source,
    definition: strategy,
  };

  const query = existingId
    ? supabase().from("strategies").update(row).eq("id", existingId).select("id").single()
    : supabase().from("strategies").insert(row).select("id").single();

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function deleteStrategy(id: string): Promise<void> {
  const { error } = await supabase().from("strategies").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listBots(): Promise<CloudBot[]> {
  const { data, error } = await supabase().from("bots")
    .select("id, name, strategy_id, deriv_account_id, status, status_detail, last_heartbeat, started_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CloudBot[];
}

/**
 * Creates a bot in `starting`. The runner picks it up on its next poll — the
 * web app never contacts the runner directly, which is what lets the runner be
 * restarted or moved without the app caring.
 */
export async function startBot(opts: {
  strategyId: string;
  name: string;
  derivAccountId: string;
}): Promise<string> {
  const { data: auth } = await supabase().auth.getUser();
  if (!auth.user) throw new Error("Sign in to run cloud bots.");

  const { data, error } = await supabase().from("bots")
    .insert({
      user_id: auth.user.id,
      strategy_id: opts.strategyId,
      deriv_account_id: opts.derivAccountId,
      name: opts.name,
      status: "starting",
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function stopBot(botId: string): Promise<void> {
  const { error } = await supabase().from("bots").update({ status: "stopping" }).eq("id", botId);
  if (error) throw new Error(error.message);
}

export async function botEvents(botId: string, limit = 50): Promise<BotEvent[]> {
  const { data, error } = await supabase().from("bot_events")
    .select("id, level, message, created_at")
    .eq("bot_id", botId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as BotEvent[];
}

/**
 * A bot whose heartbeat has gone stale is not running, whatever its status
 * says. Showing it as live would have the user believe trades are being placed
 * when nothing is executing.
 */
export function isStale(bot: CloudBot): boolean {
  if (bot.status !== "running") return false;
  if (!bot.last_heartbeat) return true;
  return Date.now() - Date.parse(bot.last_heartbeat) > 90_000;
}
