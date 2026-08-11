"use client";

import { useEffect, useRef, useState } from "react";
import {
  DbotImportError,
  STRATEGY_PRESETS,
  exportStrategy,
  importDbotXml,
  importStrategyJson,
  validateStrategy,
  type ImportWarning,
  type Strategy,
} from "@tradezaki/core";
import { useDeriv } from "@/components/DerivProvider";
import StrategyEditor from "@/components/StrategyEditor";
import { useBotSession, type BotMode } from "@/components/useBotSession";
import CloudBots from "@/components/CloudBots";
import { isCloudConfigured, supabase } from "@/lib/supabase";

type Source = "none" | "preset" | "import" | "new";

export default function BotsPage() {
  const { currency, symbol, account, setSymbol, symbols, available } = useDeriv();
  const xmlRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);

  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [source, setSource] = useState<Source>("none");
  const [warnings, setWarnings] = useState<ImportWarning[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<BotMode>("dry");
  const [showPresets, setShowPresets] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!isCloudConfigured) return;
    void supabase()
      .auth.getUser()
      .then(({ data }) => setSignedIn(!!data.user))
      .catch(() => setSignedIn(false));
  }, []);

  const bot = useBotSession(strategy, mode);
  const isReal = account?.accountType === "real";

  function load(s: Strategy, src: Source, warns: ImportWarning[] = [], needsReview = false) {
    setStrategy(s);
    setSource(src);
    setWarnings(warns);
    setReviewed(!needsReview);
    setError(null);
    if (symbols.some((x) => x.symbol === s.symbol)) setSymbol(s.symbol);
  }

  function startBlank() {
    const sym = symbol ?? symbols.find((s) => s.isOpen)?.symbol ?? "R_100";
    const hasEvenOdd = available.some((a) => a.contractType === "DIGITEVEN");
    load(
      {
        name: "My strategy",
        symbol: sym,
        contract: hasEvenOdd
          ? { contractType: "DIGITEVEN", basis: "stake", duration: 1, durationUnit: "t" }
          : { contractType: "CALL", basis: "stake", duration: 5, durationUnit: "t" },
        ...(hasEvenOdd
          ? {
              contractAlt: {
                contractType: "DIGITODD",
                basis: "stake",
                duration: 1,
                durationUnit: "t",
              },
              entryAlt: { op: "always" as const },
            }
          : {}),
        entry: { op: "always" },
        staking: { type: "fixed", amount: 1 },
        limits: { stopLoss: 20, takeProfit: 20, maxStake: 10 },
        cooldownTicks: 1,
      },
      "new"
    );
  }

  async function onXml(file: File) {
    try {
      const r = importDbotXml(await file.text(), file.name.replace(/\.xml$/i, ""));
      load(r.strategy, "import", r.warnings, r.needsReview);
    } catch (err) {
      setError(err instanceof DbotImportError ? err.message : "Couldn't read that file.");
    }
  }

  async function onJson(file: File) {
    const r = importStrategyJson(await file.text());
    if (!r.ok || !r.strategy) {
      setError(r.issues.map((i) => i.message).join(" ") || "That strategy file isn't valid.");
      return;
    }
    load(r.strategy, "import");
  }

  function download() {
    if (!strategy) return;
    const blob = new Blob([exportStrategy(strategy)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${strategy.name.replace(/[^\w.-]+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const validation = strategy ? validateStrategy(strategy) : null;
  const wrongMarket = strategy && symbol !== strategy.symbol;
  const blocked = !reviewed || !!wrongMarket || (validation ? !validation.ok : true);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">
        <header className="mb-5">
          <h1 className="font-display font-bold text-2xl">Bots</h1>
          <p className="text-sm text-mist mt-1">
            Build one, start from a preset, or import a Deriv Bot file — then dry-run
            it before risking anything.
          </p>
        </header>

        {/* ---- how to start ---- */}
        <div className="flex flex-wrap gap-2 mb-5">
          <button onClick={startBlank} className="btn-primary">
            Build a bot
          </button>
          <button onClick={() => setShowPresets((v) => !v)} className="btn">
            {showPresets ? "Hide presets" : "Use a preset"}
          </button>
          <button onClick={() => xmlRef.current?.click()} className="btn">
            Import DBot .xml
          </button>
          <button onClick={() => jsonRef.current?.click()} className="btn">
            Open saved bot
          </button>
          {strategy && (
            <button onClick={download} className="btn ml-auto">
              Download
            </button>
          )}
          <input
            ref={xmlRef}
            type="file"
            accept=".xml,text/xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onXml(f);
              e.target.value = "";
            }}
          />
          <input
            ref={jsonRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onJson(f);
              e.target.value = "";
            }}
          />
        </div>

        {error && (
          <p className="text-xs text-danger bg-danger/10 border border-danger/30 rounded-md px-3 py-2 mb-4">
            {error}
          </p>
        )}

        {showPresets && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
            {STRATEGY_PRESETS.map((p) => {
              const have = new Set(available.map((a) => a.contractType));
              const usable = have.size === 0 || p.requires.every((t) => have.has(t));
              return (
                <button
                  key={p.id}
                  disabled={!usable}
                  onClick={() => {
                    load(p.build(symbol ?? "R_100", 1), "preset");
                    setShowPresets(false);
                  }}
                  className="text-left border border-line hover:border-signal rounded-lg p-3.5 bg-panel/50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-medium text-sm">{p.name}</span>
                    <span
                      className={`font-mono text-[9px] uppercase px-1.5 py-0.5 rounded ${
                        p.risk === "high"
                          ? "bg-danger/15 text-danger"
                          : p.risk === "medium"
                            ? "bg-alert/15 text-alert"
                            : "bg-signal/15 text-signal"
                      }`}
                    >
                      {p.risk}
                    </span>
                  </div>
                  <p className="text-[11px] text-mist leading-relaxed mb-2">{p.blurb}</p>
                  {/* The honest part. A preset library that only sells the
                      upside is how people talk themselves into a martingale. */}
                  <p className="text-[10px] text-mist/70 leading-relaxed border-t border-line pt-2">
                    {p.edge}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {!strategy ? (
          <div className="border border-dashed border-line rounded-lg py-16 text-center">
            <p className="text-sm text-mist">
              Pick one of the options above to get started.
            </p>
          </div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-5">
            {/* ---- editor ---- */}
            <section className="space-y-4">
              {warnings.length > 0 && (
                <div className="border border-alert/30 bg-alert/5 rounded-lg p-4">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-alert mb-2">
                    What didn&apos;t come across
                  </p>
                  <ul className="space-y-1.5 text-[12px] text-mist">
                    {warnings.map((w, i) => (
                      <li key={i}>• {w.message}</li>
                    ))}
                  </ul>
                  <label className="flex items-start gap-2 mt-3 text-[12px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(e) => setReviewed(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span className={reviewed ? "text-mist" : ""}>
                      I&apos;ve set the entry rules below and understand this is not a
                      faithful copy of the original bot.
                    </span>
                  </label>
                </div>
              )}

              <div className="border border-line rounded-lg bg-panel/50 p-4">
                <StrategyEditor
                  strategy={strategy}
                  onChange={setStrategy}
                  currency={currency}
                  lockContract={source === "import"}
                />
              </div>

              {validation && !validation.ok && (
                <ul className="text-[12px] text-danger space-y-1">
                  {validation.issues.map((i, n) => (
                    <li key={n}>• {i.message}</li>
                  ))}
                </ul>
              )}
            </section>

            {/* ---- run ---- */}
            <section className="space-y-4">
              <div className="border border-line rounded-lg bg-panel/50 p-4">
                <div className="flex gap-1.5 mb-4">
                  {(["dry", "live"] as const).map((m) => (
                    <button
                      key={m}
                      disabled={bot.running}
                      onClick={() => setMode(m)}
                      className={`flex-1 py-2 rounded-md border text-sm transition disabled:opacity-50 ${
                        mode === m
                          ? m === "dry"
                            ? "border-signal text-signal bg-signal/10"
                            : "border-danger text-danger bg-danger/10"
                          : "border-line text-mist hover:border-mist"
                      }`}
                    >
                      {m === "dry" ? "Dry run" : "Live"}
                    </button>
                  ))}
                </div>

                <p className="text-[11px] text-mist mb-4 leading-relaxed">
                  {mode === "dry" ? (
                    <>
                      Real ticks and real prices, settled from the tick stream.{" "}
                      <strong className="text-signal">No trades reach Deriv.</strong>
                    </>
                  ) : (
                    <>
                      Places real contracts on{" "}
                      <strong className={isReal ? "text-danger" : "text-signal"}>
                        {account
                          ? `${account.accountType === "demo" ? "DEMO" : "REAL MONEY"} ${account.accountId}`
                          : "the selected account"}
                      </strong>
                      .
                    </>
                  )}
                </p>

                {wrongMarket && (
                  <p className="text-[11px] text-danger bg-danger/10 border border-danger/30 rounded-md px-3 py-2 mb-3">
                    This bot trades {strategy.symbol}, but the terminal is on {symbol}.
                  </p>
                )}

                {bot.running ? (
                  <button onClick={() => bot.stop()} className="w-full py-3 rounded-lg bg-danger text-ink font-semibold hover:brightness-110 transition">
                    Stop bot
                  </button>
                ) : (
                  <button
                    onClick={bot.start}
                    disabled={!bot.canStart || blocked}
                    className="w-full py-3 rounded-lg bg-signal text-ink font-semibold hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {!reviewed
                      ? "Confirm the entry rules first"
                      : mode === "dry"
                        ? "Start dry run"
                        : "Start live"}
                  </button>
                )}
              </div>

              <div className="border border-line rounded-lg bg-panel/50 p-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-mist mb-3">
                  Run in the cloud
                </p>
                <CloudBots strategy={strategy} signedIn={signedIn} />
              </div>

              {bot.session && (
                <div className="grid grid-cols-3 gap-3">
                  <Stat label="Trades" value={String(bot.session.trades)} />
                  <Stat
                    label="Win rate"
                    value={
                      bot.session.wins + bot.session.losses > 0
                        ? `${Math.round((bot.session.wins / (bot.session.wins + bot.session.losses)) * 100)}%`
                        : "—"
                    }
                  />
                  <Stat
                    label="P/L"
                    value={`${bot.session.profit >= 0 ? "+" : ""}${bot.session.profit.toFixed(2)}`}
                    tone={bot.session.profit > 0 ? "up" : bot.session.profit < 0 ? "down" : undefined}
                  />
                </div>
              )}

              <div className="border border-line rounded-lg bg-panel/50 overflow-hidden">
                <p className="font-mono text-[10px] uppercase tracking-widest text-mist px-4 py-2.5 border-b border-line">
                  Activity
                </p>
                {bot.log.length === 0 ? (
                  <p className="p-4 text-xs text-mist">Nothing yet.</p>
                ) : (
                  <ul className="max-h-[420px] overflow-y-auto divide-y divide-line/50">
                    {bot.log.map((e) => (
                      <li key={e.id} className="px-4 py-2 flex items-start gap-2 text-[12px]">
                        <span
                          className={`font-mono text-[10px] shrink-0 w-14 ${
                            e.kind === "error"
                              ? "text-danger"
                              : e.kind === "settle"
                                ? (e.profit ?? 0) >= 0
                                  ? "text-signal"
                                  : "text-danger"
                                : e.kind === "buy"
                                  ? "text-alert"
                                  : "text-mist"
                          }`}
                        >
                          {e.kind}
                        </span>
                        <span className="text-mist">{e.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="border border-line rounded-lg p-3 bg-panel/50">
      <p className="font-mono text-[9px] uppercase tracking-widest text-mist mb-1">{label}</p>
      <p
        className={`font-display font-bold text-lg ${
          tone === "up" ? "text-signal" : tone === "down" ? "text-danger" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
