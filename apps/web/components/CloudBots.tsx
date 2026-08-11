"use client";

import { useCallback, useEffect, useState } from "react";
import type { Strategy } from "@tradezaki/core";
import { useDeriv } from "@/components/DerivProvider";
import { isCloudConfigured } from "@/lib/supabase";
import {
  botEvents,
  isStale,
  listBots,
  listStrategies,
  saveStrategy,
  startBot,
  stopBot,
  type BotEvent,
  type CloudBot,
  type SavedStrategy,
} from "@/lib/cloud";

/**
 * Cloud bots — the ones that keep running after this tab closes.
 *
 * Everything here talks to Postgres, never to the runner. Starting a bot writes
 * a status and waits; that indirection is what lets the runner be restarted or
 * moved without the app knowing.
 */
export default function CloudBots({
  strategy,
  signedIn,
}: {
  strategy: Strategy | null;
  signedIn: boolean;
}) {
  const { account, accounts } = useDeriv();
  const [saved, setSaved] = useState<SavedStrategy[]>([]);
  const [bots, setBots] = useState<CloudBot[]>([]);
  const [events, setEvents] = useState<Record<string, BotEvent[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    try {
      const [s, b] = await Promise.all([listStrategies(), listBots()]);
      setSaved(s);
      setBots(b);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your bots.");
    }
  }, [signedIn]);

  useEffect(() => {
    void refresh();
    // Poll rather than subscribe: a bot's status is written by the runner, and
    // a few seconds of lag is fine for something that runs for hours.
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!expanded) return;
    void botEvents(expanded).then((e) => setEvents((prev) => ({ ...prev, [expanded]: e })));
  }, [expanded, bots]);

  if (!isCloudConfigured) {
    return (
      <p className="text-[12px] text-mist">
        Cloud bots aren&apos;t set up on this deployment. Dry runs and live
        browser bots still work — they just stop when you close the tab.
      </p>
    );
  }

  if (!signedIn) {
    return (
      <p className="text-[12px] text-mist">
        Reconnect with Deriv to use cloud bots — they need a Tradezaki account,
        which is created for you on login.
      </p>
    );
  }

  async function saveAndRun() {
    if (!strategy || !account) return;
    setBusy(true);
    setError(null);
    try {
      const strategyId = await saveStrategy(strategy, "builder");
      await startBot({
        strategyId,
        name: strategy.name,
        derivAccountId: account.accountId,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the bot.");
    } finally {
      setBusy(false);
    }
  }

  const isReal = account?.accountType === "real";

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-[11px] text-danger bg-danger/10 border border-danger/30 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <button
        onClick={saveAndRun}
        disabled={!strategy || !account || busy}
        className="w-full py-2.5 rounded-lg border border-line hover:border-signal text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy
          ? "Starting…"
          : !strategy
            ? "Build or import a strategy first"
            : `Run in the cloud on ${isReal ? "REAL" : "DEMO"} ${account?.accountId ?? ""}`}
      </button>

      <p className="text-[10px] text-mist leading-relaxed">
        Cloud bots keep running when you close this tab. They need the runner to
        be online — if nothing picks the bot up, it will show as an error rather
        than sitting there looking alive.
      </p>

      {bots.length > 0 && (
        <ul className="border border-line rounded-lg divide-y divide-line/60 overflow-hidden">
          {bots.map((b) => {
            const stale = isStale(b);
            const tone =
              b.status === "running" && !stale
                ? "text-signal"
                : b.status === "error" || stale
                  ? "text-danger"
                  : "text-alert";
            return (
              <li key={b.id}>
                <div className="px-3 py-2.5 flex items-center gap-2">
                  <button
                    onClick={() => setExpanded(expanded === b.id ? null : b.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="text-[12px] truncate">{b.name}</p>
                    <p className={`font-mono text-[10px] ${tone}`}>
                      {stale ? "not responding" : b.status}
                      {b.status_detail ? ` · ${b.status_detail}` : ""}
                    </p>
                  </button>
                  {(b.status === "running" || b.status === "starting") && (
                    <button
                      onClick={() => void stopBot(b.id).then(refresh)}
                      className="text-[11px] border border-line hover:border-danger hover:text-danger rounded-md px-2.5 py-1.5 transition"
                    >
                      Stop
                    </button>
                  )}
                </div>

                {expanded === b.id && (
                  <ul className="bg-ink/50 px-3 py-2 space-y-1 max-h-40 overflow-y-auto">
                    {(events[b.id] ?? []).length === 0 ? (
                      <li className="text-[11px] text-mist">No events yet.</li>
                    ) : (
                      events[b.id].map((e) => (
                        <li key={e.id} className="text-[11px] flex gap-2">
                          <span
                            className={`font-mono shrink-0 ${
                              e.level === "error"
                                ? "text-danger"
                                : e.level === "warn"
                                  ? "text-alert"
                                  : "text-mist"
                            }`}
                          >
                            {e.level}
                          </span>
                          <span className="text-mist">{e.message}</span>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {saved.length > 0 && (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-mist hover:text-[#E7ECE9]">
            Saved strategies ({saved.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {saved.map((s) => (
              <li key={s.id} className="font-mono text-[11px] text-mist truncate">
                {s.name}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
