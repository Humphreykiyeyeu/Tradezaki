"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DerivClient,
  DEFAULT_RISK_CONFIG,
  checkTradeAllowed,
  sessionSummary,
  type ActiveSymbol,
  type ConnectionState,
  type ContractAvailability,
  type TradeLogEntry,
  type RiskGuardianConfig,
} from "@tradezaki/core";
import { getValidToken, SessionExpiredError } from "@/lib/session";
import SymbolPicker from "@/components/SymbolPicker";
import TradePanel, { type TradeIntent } from "@/components/TradePanel";
import TickChart, { type Tick } from "@/components/TickChart";

const MAX_TICKS = 60;

const STATE_STYLE: Record<ConnectionState, { label: string; dot: string }> = {
  connecting: { label: "Connecting", dot: "bg-alert" },
  connected: { label: "Live", dot: "bg-signal" },
  reconnecting: { label: "Reconnecting", dot: "bg-alert animate-pulse" },
  offline: { label: "Offline", dot: "bg-danger" },
};

interface Account {
  accountId: string;
  balance: string;
  currency: string;
  accountType: string;
  status: string;
}

export default function DashboardPage() {
  const clientRef = useRef<DerivClient | null>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [connState, setConnState] = useState<ConnectionState>("connecting");
  const [notice, setNotice] = useState<string | null>(null);

  const [symbols, setSymbols] = useState<ActiveSymbol[]>([]);
  const [symbol, setSymbol] = useState<string | null>(null);
  const [available, setAvailable] = useState<ContractAvailability[]>([]);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [barrierOffset, setBarrierOffset] = useState<string | null>(null);

  const [trades, setTrades] = useState<TradeLogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [riskConfig] = useState<RiskGuardianConfig>({
    ...DEFAULT_RISK_CONFIG,
    dailyLossLimit: 20,
    maxConsecutiveLosses: 3,
  });

  const account = accounts.find((a) => a.accountId === activeId) ?? null;
  const isReal = account?.accountType === "real";
  const activeSymbol = symbols.find((s) => s.symbol === symbol) ?? null;

  // ---- accounts -----------------------------------------------------------
  useEffect(() => {
    const saved = localStorage.getItem("tradezaki_trades");
    if (saved) setTrades(JSON.parse(saved));

    (async () => {
      const accessToken = await getValidToken();
      const r = await fetch("/api/deriv/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken }),
      });
      const data = await r.json();
      if (!data.accounts?.length) {
        setNotice(data.error ?? "No tradable Deriv accounts found.");
        return;
      }
      setAccounts(data.accounts);
      const demo = data.accounts.find((a: Account) => a.accountType === "demo");
      setActiveId((demo ?? data.accounts[0]).accountId);
    })().catch((err) =>
      setNotice(
        err instanceof SessionExpiredError
          ? "Session expired — reconnect with Deriv."
          : "Could not load your Deriv accounts."
      )
    );
  }, []);

  // ---- connection ---------------------------------------------------------
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;

    const client = new DerivClient(async () => {
      const accessToken = await getValidToken();
      const r = await fetch("/api/deriv/ws-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeId, accessToken }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Could not start a trading session.");
      return body.url as string;
    });
    clientRef.current = client;

    client.onStateChange((s) => !cancelled && setConnState(s));
    client.subscribeBalance((bal, cur) => {
      if (cancelled) return;
      setBalance(bal);
      setCurrency(cur);
    });

    client
      .connect()
      .then(async () => {
        if (cancelled) return;
        const list = await client.getActiveSymbols();
        if (cancelled) return;
        setSymbols(list);
        setSymbol((current) => current ?? list.find((s) => s.isOpen)?.symbol ?? null);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      client.disconnect();
    };
  }, [activeId]);

  // ---- per-symbol market data --------------------------------------------
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !symbol || connState !== "connected") return;
    let cancelled = false;

    setTicks([]);
    client
      .getContractsFor(symbol)
      .then((list) => !cancelled && setAvailable(list))
      .catch(() => !cancelled && setAvailable([]));

    const stop = client.subscribeTicks(symbol, (quote, epoch) => {
      if (cancelled) return;
      setTicks((prev) => [...prev, { quote, epoch }].slice(-MAX_TICKS));
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, [symbol, connState]);

  // ---- trade log ----------------------------------------------------------
  function persist(next: TradeLogEntry[]) {
    localStorage.setItem("tradezaki_trades", JSON.stringify(next));
    return next;
  }

  function settleTrade(id: string, result: "won" | "lost", profit: number) {
    setTrades((prev) => persist(prev.map((t) => (t.id === id ? { ...t, result, profit } : t))));
  }

  const handleBarrierChange = useCallback((v: string | null) => setBarrierOffset(v), []);

  /** Prices an intent without buying it. Errors are returned, not thrown, so the
   *  panel can label a side "no return" instead of looking broken. */
  const quoteIntent = useCallback(
    async (intent: TradeIntent): Promise<{ payout: number } | { error: string }> => {
      const client = clientRef.current;
      if (!client || !symbol) return { error: "Not connected" };
      try {
        const p = await client.getProposal({
          symbol,
          contractType: intent.contractType,
          amount: intent.stake,
          currency,
          basis: "stake",
          duration: intent.duration,
          durationUnit: intent.durationUnit,
          barrier: intent.barrier,
          barrier2: intent.barrier2,
          selectedTick: intent.selectedTick,
        });
        return { payout: p.payout };
      } catch (err) {
        const msg =
          typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : "Unavailable";
        return { error: /no return/i.test(msg) ? "No return" : msg.slice(0, 40) };
      }
    },
    [symbol, currency]
  );

  async function placeTrade(intent: TradeIntent) {
    setBlockedReason(null);
    const check = checkTradeAllowed(riskConfig, trades, intent.stake, balance ?? 0);
    if (!check.allowed) {
      setBlockedReason(check.reason ?? "Trade blocked by Risk Guardian.");
      return;
    }

    const client = clientRef.current;
    if (!client || !symbol) return;

    setBusy(intent.contractType);
    try {
      const proposal = await client.getProposal({
        symbol,
        contractType: intent.contractType,
        amount: intent.stake,
        currency,
        basis: "stake",
        duration: intent.duration,
        durationUnit: intent.durationUnit,
        barrier: intent.barrier,
        barrier2: intent.barrier2,
        selectedTick: intent.selectedTick,
      });

      // Deriv applies the app's registered markup itself, so askPrice is final.
      const contractId = await client.buyContract(proposal.id, proposal.askPrice);
      const id = String(contractId);

      setTrades((prev) =>
        persist([
          ...prev,
          {
            id,
            timestamp: Date.now(),
            symbol,
            contractType: intent.contractType,
            stake: intent.stake,
            result: "open",
            profit: 0,
            accountId: account?.accountId ?? "active",
          },
        ])
      );

      client.watchContract(contractId, (result, profit) => settleTrade(id, result, profit));
    } catch (err) {
      const detail =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : null;
      setBlockedReason(detail ?? "Trade failed. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const summary = sessionSummary(trades);
  const open = trades.filter((t) => t.result === "open");
  const recent = [...trades].reverse().slice(0, 12);

  // Absolute barrier price, for the chart's reference line.
  const lastQuote = ticks.length ? ticks[ticks.length - 1].quote : null;
  const barrierPrice =
    barrierOffset && lastQuote !== null && /^[+-]?\d*\.?\d+$/.test(barrierOffset.trim())
      ? lastQuote + Number(barrierOffset)
      : null;

  return (
    <main className="min-h-screen bg-ink">
      <header className="border-b border-line px-4 md:px-8 py-4 flex items-center justify-between gap-4 sticky top-0 bg-ink/95 backdrop-blur z-30">
        <span className="font-display font-bold text-lg tracking-tight">Tradezaki</span>
        <div className="flex items-center gap-2 font-mono text-xs text-mist">
          <span className={`w-2 h-2 rounded-full ${STATE_STYLE[connState].dot}`} />
          {STATE_STYLE[connState].label}
        </div>
      </header>

      <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
        {notice && (
          <p className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 mb-5">
            {notice}
          </p>
        )}

        {/* Accounts */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          {accounts.map((a) => {
            const active = a.accountId === activeId;
            const demo = a.accountType === "demo";
            return (
              <button
                key={a.accountId}
                onClick={() => setActiveId(a.accountId)}
                className={`font-mono text-xs px-3 py-2 rounded-md border transition ${
                  active
                    ? demo
                      ? "border-signal text-signal bg-signal/10"
                      : "border-danger text-danger bg-danger/10"
                    : "border-line text-mist hover:border-mist"
                }`}
              >
                {demo ? "DEMO" : "REAL"} · {Number(a.balance).toFixed(2)} {a.currency}
              </button>
            );
          })}
        </div>

        {isReal && (
          <p className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 mb-5">
            Real money — trades here use your actual balance.
          </p>
        )}

        <div className="grid lg:grid-cols-3 gap-5 mb-5">
          <Stat
            label="Balance"
            value={balance !== null ? `${balance.toFixed(2)} ${currency}` : "—"}
          />
          <Stat label="Trades today" value={String(summary.tradeCount)} />
          <Stat
            label="Net today"
            value={
              summary.tradeCount > 0
                ? `${summary.netProfit >= 0 ? "+" : ""}${summary.netProfit.toFixed(2)} ${currency}`
                : "—"
            }
            tone={summary.netProfit > 0 ? "up" : summary.netProfit < 0 ? "down" : undefined}
          />
        </div>

        <div className="grid lg:grid-cols-3 gap-5">
          {/* Chart + market */}
          <section className="lg:col-span-2 space-y-5">
            <div className="bg-panel border border-line rounded-xl p-5">
              <SymbolPicker symbols={symbols} value={symbol} onChange={setSymbol} />
              <div className="mt-5">
                <TickChart
                  ticks={ticks}
                  pipSize={activeSymbol ? String(activeSymbol.pipSize).split(".")[1]?.length ?? 2 : 2}
                  barrier={barrierPrice}
                  symbolName={activeSymbol?.displayName ?? symbol ?? ""}
                />
              </div>
            </div>

            <Panel title="Open positions">
              {open.length === 0 ? (
                <p className="text-sm text-mist">Nothing open.</p>
              ) : (
                <ul className="space-y-2">
                  {open.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between font-mono text-xs border border-line rounded-md px-3 py-2"
                    >
                      <span>
                        {t.contractType} · {t.symbol}
                      </span>
                      <span className="text-alert">
                        {t.stake.toFixed(2)} {currency} · settling…
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>

          {/* Ticket */}
          <section className="space-y-5">
            <div className="bg-panel border border-line rounded-xl p-5">
              {blockedReason && (
                <p className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-md px-3 py-2.5 mb-4">
                  {blockedReason}
                </p>
              )}
              <TradePanel
                available={available}
                currency={currency}
                balance={balance}
                disabled={connState !== "connected" || !symbol}
                busy={busy}
                onTrade={placeTrade}
                onBarrierChange={handleBarrierChange}
                spot={lastQuote}
                onQuote={quoteIntent}
              />
            </div>

            <Panel title="Journal">
              {recent.length === 0 ? (
                <p className="text-sm text-mist">No trades yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {recent.map((t) => (
                    <li key={t.id} className="flex items-center justify-between font-mono text-[11px]">
                      <span className="text-mist truncate mr-2">{t.contractType}</span>
                      <span
                        className={
                          t.result === "won"
                            ? "text-signal"
                            : t.result === "lost"
                              ? "text-danger"
                              : "text-alert"
                        }
                      >
                        {t.result === "open"
                          ? "open"
                          : `${t.profit >= 0 ? "+" : ""}${t.profit.toFixed(2)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>
        </div>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="border border-line rounded-xl p-4 bg-panel">
      <p className="font-mono text-[10px] text-mist uppercase tracking-widest mb-1.5">{label}</p>
      <p
        className={`font-display font-bold text-2xl ${
          tone === "up" ? "text-signal" : tone === "down" ? "text-danger" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-panel border border-line rounded-xl p-5">
      <p className="font-mono text-[10px] text-mist uppercase tracking-widest mb-3">{title}</p>
      {children}
    </div>
  );
}
