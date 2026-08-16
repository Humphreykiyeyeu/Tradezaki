"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  StrategyRunner,
  STOP_REASON_TEXT,
  type SessionState,
  type StopReason,
  type Strategy,
} from "@tradezaki/core";
import { useDeriv } from "@/components/DerivProvider";

/**
 * Drives a StrategyRunner against the live tick stream, from this page.
 *
 * Trades are real and placed on whichever account is selected. The session
 * lasts exactly as long as the page does — that is the entire difference from
 * an always-on bot, and the reason this one is named for how long it survives
 * rather than for where it runs.
 *
 * There was a simulated mode here once, settling contracts from the tick stream
 * instead of buying them. It went because it could only handle the contract
 * types simple enough to settle from ticks and quietly refused the rest, while
 * a run on a demo account risks nothing *and* exercises the real path.
 */

export interface BotLogEntry {
  id: number;
  at: number;
  kind: "buy" | "settle" | "stop" | "info" | "error";
  text: string;
  profit?: number;
}

export function useBotSession(strategy: Strategy | null) {
  const { ticks, activeSymbol, currency, buy, connState, symbol, accountTrades } = useDeriv();

  const runnerRef = useRef<StrategyRunner | null>(null);
  /**
   * Epoch of the last tick processed.
   *
   * This used to be a count, which broke silently: the provider caps its tick
   * buffer, so `ticks.length` stops growing once the buffer is full and a
   * length cursor never advances again. The bot would trade for a while and
   * then go permanently blind with no error.
   */
  const lastEpochRef = useRef(0);
  const logIdRef = useRef(0);
  /** Contract ids this bot placed, and which of them have been counted. */
  const placedRef = useRef<Set<string>>(new Set());
  const settledRef = useRef<Set<string>>(new Set());

  const [running, setRunning] = useState(false);
  const [session, setSession] = useState<SessionState | null>(null);
  const [stopReason, setStopReason] = useState<StopReason | null>(null);
  const [log, setLog] = useState<BotLogEntry[]>([]);

  const decimals = activeSymbol
    ? String(activeSymbol.pipSize).split(".")[1]?.length ?? 2
    : 2;

  const append = useCallback((kind: BotLogEntry["kind"], text: string, profit?: number) => {
    logIdRef.current += 1;
    const entry: BotLogEntry = { id: logIdRef.current, at: Date.now(), kind, text, profit };
    // Newest first, and bounded — an unattended bot would otherwise grow this
    // without limit until the tab dies.
    setLog((prev) => [entry, ...prev].slice(0, 300));
  }, []);

  const stop = useCallback(
    (reason: StopReason = "stopped-by-user") => {
      runnerRef.current?.stop(reason);
      setRunning(false);
      setStopReason(reason);
      append("stop", STOP_REASON_TEXT[reason]);
    },
    [append]
  );

  const start = useCallback(() => {
    if (!strategy) return;
    const runner = new StrategyRunner({ strategy, decimals });
    runner.seed(ticks);
    runnerRef.current = runner;
    lastEpochRef.current = ticks.length ? ticks[ticks.length - 1].epoch : 0;
    logIdRef.current = 0;
    placedRef.current = new Set();
    settledRef.current = new Set();
    setSession(runner.state);
    setStopReason(null);
    setLog([]);
    setRunning(true);
    append("info", `Trading ${strategy.symbol} on the selected account.`);
  }, [strategy, decimals, ticks, append]);

  // A strategy is bound to one symbol. If the terminal is switched to another
  // market the tick stream no longer belongs to this bot, and trading on it
  // would be silently wrong.
  useEffect(() => {
    if (!running || !strategy) return;
    if (symbol && symbol !== strategy.symbol) {
      append("error", `Market changed to ${symbol}; this bot trades ${strategy.symbol}.`);
      stop("error");
    }
  }, [symbol, running, strategy, append, stop]);

  useEffect(() => {
    if (!running || connState === "connected") return;
    append("error", "Connection lost.");
    stop("error");
  }, [connState, running, append, stop]);

  // The real contract decides the outcome, and that arrives on the provider's
  // trade log rather than from us. Feed those settlements back into the runner,
  // or its staking ladder and limits never advance.
  useEffect(() => {
    const runner = runnerRef.current;
    if (!running || !runner) return;

    for (const t of accountTrades) {
      if (t.result === "open") continue;
      if (!placedRef.current.has(t.id)) continue;
      if (settledRef.current.has(t.id)) continue;

      settledRef.current.add(t.id);
      const action = runner.onSettle(t.profit);
      append(
        "settle",
        `${t.contractType} ${t.result} · ${t.profit >= 0 ? "+" : ""}${t.profit.toFixed(2)} ${currency}`,
        t.profit
      );
      setSession(runner.state);

      if (action?.kind === "stop") {
        setRunning(false);
        setStopReason(action.reason);
        append("stop", STOP_REASON_TEXT[action.reason]);
        break;
      }
    }
  }, [accountTrades, running, currency, append]);

  // Main loop: one pass per newly-arrived tick.
  useEffect(() => {
    const runner = runnerRef.current;
    if (!running || !runner || !strategy) return;
    const fresh = ticks.filter((t) => t.epoch > lastEpochRef.current);
    if (fresh.length === 0) return;
    lastEpochRef.current = fresh[fresh.length - 1].epoch;

    (async () => {
      for (const tick of fresh) {
        if (runner.isStopped) break;

        const action = runner.onTick(tick);
        if (!action) continue;

        if (action.kind === "stop") {
          setRunning(false);
          setStopReason(action.reason);
          append("stop", STOP_REASON_TEXT[action.reason]);
          break;
        }

        const { contract, amount } = action;
        const id = await buy({ ...contract, amount });

        if (!id) {
          runner.onBuyFailed();
          append("error", `Buy rejected for ${contract.contractType}.`);
        } else {
          placedRef.current.add(id);
          append("buy", `${contract.contractType} ${amount.toFixed(2)} ${currency} placed`);
        }

        setSession(runner.state);
      }
      setSession(runner.state);
    })();
  }, [ticks, running, strategy, currency, buy, append]);

  return {
    running,
    session,
    stopReason,
    log,
    start,
    stop,
    canStart: !!strategy && connState === "connected",
  };
}
