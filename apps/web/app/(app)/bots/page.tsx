"use client";

import { useEffect, useRef, useState } from "react";
import {
  DbotImportError,
  exportStrategy,
  importDbotXml,
  importStrategyJson,
  validateStrategy,
  type ImportWarning,
  type Strategy,
} from "@tradezaki/core";
import { useDeriv } from "@/components/DerivProvider";
import StrategyEditor from "@/components/StrategyEditor";
import { useBotSession } from "@/components/useBotSession";
import CloudBots from "@/components/CloudBots";
import PresetPicker from "@/components/PresetPicker";
import { isCloudConfigured, supabase } from "@/lib/supabase";

type Source = "none" | "preset" | "import" | "new";

export default function BotsPage() {
  const { currency, symbol, account, setSymbol, symbols, available } = useDeriv();
  const fileRef = useRef<HTMLInputElement>(null);

  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [source, setSource] = useState<Source>("none");
  const [warnings, setWarnings] = useState<ImportWarning[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!isCloudConfigured) return;
    void supabase()
      .auth.getUser()
      .then(({ data }) => setSignedIn(!!data.user))
      .catch(() => setSignedIn(false));
  }, []);

  const bot = useBotSession(strategy);
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

  /**
   * One opener for both file types.
   *
   * "Open saved bot" and "Import DBot .xml" were two buttons doing the same job
   * from the user's side — open a bot from a file — and asking which format it
   * is puts our implementation detail in their way. The format is detected from
   * the content rather than the extension, since a DBot file downloaded from a
   * forum is as likely to be named .txt as anything else.
   */
  async function onFile(file: File) {
    const text = await file.text();
    const looksXml = text.trimStart().startsWith("<");

    if (looksXml) {
      try {
        const r = importDbotXml(text, file.name.replace(/\.[^.]+$/, ""));
        load(r.strategy, "import", r.warnings, r.needsReview);
      } catch (err) {
        setError(err instanceof DbotImportError ? err.message : "Couldn't read that Deriv Bot file.");
      }
      return;
    }

    const r = importStrategyJson(text);
    if (!r.ok || !r.strategy) {
      setError(r.issues.map((i) => i.message).join(" ") || "That bot file isn't valid.");
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
  const unsound = !reviewed || (validation ? !validation.ok : true);

  // The browser bot trades through the terminal's own connection, so it must be
  // on the same market as the strategy. A cloud bot subscribes to the
  // strategy's symbol itself and has no terminal to disagree with — gating it on
  // what this tab happens to be showing would be meaningless.
  const blocked = unsound || !!wrongMarket;

  // Cloud bots trade unattended, so the import-review checkbox matters more
  // here, not less: nobody is watching to stop it.
  const cloudBlockedReason = !reviewed
    ? "Confirm the entry rules first"
    : validation && !validation.ok
      ? "Fix the errors in the strategy first"
      : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">
        <header className="mb-5">
          <h1 className="font-display font-bold text-2xl">Bots</h1>
          <p className="text-sm text-mist mt-1">
            Build one, start from a preset, or import a Deriv Bot file — then try
            it on a demo account before risking anything.
          </p>
        </header>

        {/* ---- how to start ---- */}
        <div className="flex flex-wrap gap-2 mb-5">
          <button onClick={startBlank} className="btn-primary">
            Build a bot
          </button>
          <button onClick={() => setShowPresets((v) => !v)} className="btn">
Use a preset
          </button>
          <button onClick={() => fileRef.current?.click()} className="btn">
            Open a bot file
          </button>
          {strategy && (
            <button onClick={download} className="btn ml-auto">
              Download
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json,.xml,application/json,text/xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
        </div>

        {error && (
          <p className="text-xs text-danger bg-danger/10 border border-danger/30 rounded-md px-3 py-2 mb-4">
            {error}
          </p>
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

            {/* ---- run ----
                Cloud first, deliberately. Running a bot that survives the tab
                closing is the product; the in-tab runner is a rehearsal for it.
                When the in-tab bot was the prominent green button, people
                pressed it, closed the tab, and reasonably concluded the whole
                thing was broken. */}
            <section className="space-y-4">
              <div className="border border-signal/30 rounded-lg bg-panel/50 p-4">
                {/* The names do the explaining. "Always on" and "Temporary" tell
                    you what happens when you walk away; "cloud" and "in this
                    tab" describe where code executes, which is our problem and
                    not the user's. */}
                <p className="font-mono text-[10px] uppercase tracking-widest text-signal mb-1">
                  Keeps running after you leave
                </p>
                <p className="text-[11px] text-mist mb-3 leading-relaxed">
                  Runs on our servers. Close the page, shut the laptop, come back
                  tomorrow — it carries on.
                </p>
                <CloudBots
                  strategy={strategy}
                  signedIn={signedIn}
                  blockedReason={cloudBlockedReason}
                />
              </div>

              <div className="border border-line rounded-lg bg-panel/50 p-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-mist mb-1">
                  Runs while this page is open
                </p>
                <p className="text-[11px] text-mist mb-4 leading-relaxed">
                  Stops the moment you close or leave this page. Trades on{" "}
                  <strong className={isReal ? "text-ocean" : "text-signal"}>
                    {account
                      ? `${account.accountType === "demo" ? "DEMO" : "REAL MONEY"} ${account.accountId}`
                      : "the selected account"}
                  </strong>
                  .
                </p>

                {wrongMarket && (
                  <p className="text-[11px] text-danger bg-danger/10 border border-danger/30 rounded-md px-3 py-2 mb-3">
                    This bot trades {strategy.symbol}, but the terminal is on {symbol}.
                  </p>
                )}

                {bot.running ? (
                  <button onClick={() => bot.stop()} className="w-full py-2.5 rounded-lg border border-danger text-danger text-sm hover:bg-danger/10 transition">
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={bot.start}
                    disabled={!bot.canStart || blocked}
                    className={`w-full py-2.5 rounded-lg border text-sm transition disabled:opacity-40 disabled:cursor-not-allowed ${
                      isReal
                        ? "border-ocean/50 text-ocean hover:bg-ocean/10"
                        : "border-line hover:border-signal"
                    }`}
                  >
                    {!reviewed ? "Confirm the entry rules first" : "Start"}
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

      {/* Presets live in their own layer rather than in the page.
          Inline, the grid pushed the builder down the screen and both were
          visible at once, so picking a preset and pressing "Build a bot"
          looked like two competing answers to the same question. It also did
          not scale: a hundred presets would have been a hundred cards between
          the buttons and the editor. */}
      {showPresets && (
        <PresetPicker
          available={available}
          symbol={symbol}
          onClose={() => setShowPresets(false)}
          onPick={(p) => {
            load(p.build(symbol ?? "R_100", 1), "preset");
            setShowPresets(false);
          }}
        />
      )}
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
