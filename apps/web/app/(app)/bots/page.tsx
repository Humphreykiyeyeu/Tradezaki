"use client";

import { useRef, useState } from "react";
import {
  DbotImportError,
  importDbotXml,
  type ImportWarning,
  type Strategy,
} from "@tradezaki/core";
import { useDeriv } from "@/components/DerivProvider";
import StrategyEditor from "@/components/StrategyEditor";
import { useBotSession, type BotMode } from "@/components/useBotSession";

export default function BotsPage() {
  const { currency, symbol, account, setSymbol, symbols } = useDeriv();
  const fileRef = useRef<HTMLInputElement>(null);

  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [warnings, setWarnings] = useState<ImportWarning[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [mode, setMode] = useState<BotMode>("dry");

  const bot = useBotSession(strategy, mode);
  const isReal = account?.accountType === "real";

  async function onFile(file: File) {
    setImportError(null);
    try {
      const text = await file.text();
      const result = importDbotXml(text, file.name.replace(/\.xml$/i, ""));
      setStrategy(result.strategy);
      setWarnings(result.warnings);
      // Every import needs review — the entry logic was never translated.
      setReviewed(!result.needsReview);
      if (symbols.some((s) => s.symbol === result.strategy.symbol)) {
        setSymbol(result.strategy.symbol);
      }
    } catch (err) {
      setStrategy(null);
      setImportError(
        err instanceof DbotImportError ? err.message : "Couldn't read that file."
      );
    }
  }

  const wrongMarket = strategy && symbol !== strategy.symbol;
  const blocked = !reviewed || !!wrongMarket;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">
        <header className="mb-6">
          <h1 className="font-display font-bold text-2xl">Bots</h1>
          <p className="text-sm text-mist mt-1">
            Import a Deriv Bot strategy, set when it should trade, then dry-run it
            before risking anything.
          </p>
        </header>

        <div className="grid lg:grid-cols-2 gap-5">
          {/* ---- left: strategy ---- */}
          <section className="space-y-4">
            <div className="border border-line rounded-lg bg-panel/50 p-4">
              <input
                ref={fileRef}
                type="file"
                accept=".xml,text/xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full border border-dashed border-line hover:border-signal rounded-lg py-6 text-sm text-mist hover:text-signal transition"
              >
                Import a DBot .xml strategy
              </button>
              {importError && (
                <p className="text-xs text-danger mt-3">{importError}</p>
              )}
            </div>

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

                {/* Always rendered. Hiding it once ticked makes it vanish mid-
                    interaction and leaves no way to change your mind. */}
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

            {strategy && (
              <div className="border border-line rounded-lg bg-panel/50 p-4">
                <StrategyEditor
                  strategy={strategy}
                  onChange={setStrategy}
                  currency={currency}
                />
              </div>
            )}
          </section>

          {/* ---- right: run ---- */}
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
                  This bot trades {strategy!.symbol}, but the terminal is on {symbol}.
                  Switch market before starting.
                </p>
              )}

              {bot.running ? (
                <button
                  onClick={() => bot.stop()}
                  className="w-full py-3 rounded-lg bg-danger text-ink font-semibold hover:brightness-110 transition"
                >
                  Stop bot
                </button>
              ) : (
                <button
                  onClick={bot.start}
                  disabled={!bot.canStart || blocked}
                  className="w-full py-3 rounded-lg bg-signal text-ink font-semibold hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {!strategy
                    ? "Import a strategy first"
                    : !reviewed
                      ? "Confirm the entry rules first"
                      : mode === "dry"
                        ? "Start dry run"
                        : "Start live"}
                </button>
              )}
            </div>

            {bot.session && (
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Trades" value={String(bot.session.trades)} />
                <Stat
                  label="Win rate"
                  value={
                    bot.session.wins + bot.session.losses > 0
                      ? `${Math.round(
                          (bot.session.wins / (bot.session.wins + bot.session.losses)) * 100
                        )}%`
                      : "—"
                  }
                />
                <Stat
                  label="P/L"
                  value={`${bot.session.profit >= 0 ? "+" : ""}${bot.session.profit.toFixed(2)}`}
                  tone={
                    bot.session.profit > 0 ? "up" : bot.session.profit < 0 ? "down" : undefined
                  }
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
