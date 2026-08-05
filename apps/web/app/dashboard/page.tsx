"use client";

import { useEffect, useRef, useState } from "react";
import {
  DerivClient,
  DEFAULT_RISK_CONFIG,
  checkTradeAllowed,
  sessionSummary,
  type TradeLogEntry,
  type RiskGuardianConfig,
} from "@tradezaki/core";
import {
  DERIV_WS_APP_ID,
  DERIV_MARKUP_PERCENTAGE,
  IS_USING_FALLBACK_APP_ID,
} from "@/lib/derivConfig";

const SYMBOL = "R_75"; // Volatility 75 Index — liquid, always-on, good default
const STAKE = 5;

export default function DashboardPage() {
  const clientRef = useRef<DerivClient | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [status, setStatus] = useState("Connecting...");
  const [trades, setTrades] = useState<TradeLogEntry[]>([]);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [riskConfig] = useState<RiskGuardianConfig>({
    ...DEFAULT_RISK_CONFIG,
    dailyLossLimit: 20,
    maxConsecutiveLosses: 3,
  });

  useEffect(() => {
    const token = localStorage.getItem("tradezaki_active_token");
    if (!token) {
      setStatus("No connected account. Go back and connect with Deriv.");
      return;
    }

    const savedTrades = localStorage.getItem("tradezaki_trades");
    if (savedTrades) setTrades(JSON.parse(savedTrades));

    const client = new DerivClient(DERIV_WS_APP_ID, DERIV_MARKUP_PERCENTAGE);
    clientRef.current = client;

    client
      .connect()
      .then(() => client.authorize(token))
      .then(() => {
        setStatus("Connected");
        client.subscribeBalance((bal, cur) => {
          setBalance(bal);
          setCurrency(cur);
        });
      })
      .catch(() => setStatus("Connection failed. Check your token and try reconnecting."));

    return () => client.disconnect();
  }, []);

  function logTrade(entry: TradeLogEntry) {
    setTrades((prev) => {
      const next = [...prev, entry];
      localStorage.setItem("tradezaki_trades", JSON.stringify(next));
      return next;
    });
  }

  /** Replaces a trade's placeholder "open" state with its real settled outcome. */
  function settleTrade(id: string, result: "won" | "lost", profit: number) {
    setTrades((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, result, profit } : t));
      localStorage.setItem("tradezaki_trades", JSON.stringify(next));
      return next;
    });
  }

  async function placeTrade(direction: "CALL" | "PUT") {
    setBlockedReason(null);
    const check = checkTradeAllowed(riskConfig, trades, STAKE, balance ?? 0);
    if (!check.allowed) {
      setBlockedReason(check.reason ?? "Trade blocked by Risk Guardian.");
      return;
    }

    const client = clientRef.current;
    if (!client) return;

    try {
      const req = {
        symbol: SYMBOL,
        contractType: direction,
        amount: STAKE,
        currency,
        basis: "stake" as const,
        duration: 5,
        durationUnit: "t" as const,
      };
      const proposal = await client.getProposal(req);

      // The proposal price excludes markup (Deriv won't accept the parameter on
      // `proposal`), so the buy will cost more than askPrice. Give `price` room
      // for the markup or the buy is rejected as underpriced.
      const maxPrice =
        proposal.askPrice + (DERIV_MARKUP_PERCENTAGE / 100) * proposal.payout;

      const contractId = await client.buyContract(proposal, maxPrice, req);
      const id = String(contractId);

      logTrade({
        id,
        timestamp: Date.now(),
        symbol: SYMBOL,
        contractType: direction,
        stake: STAKE,
        result: "open",
        profit: 0,
        accountId: "active",
      });

      // Deriv tells us the real win/loss when the contract settles. Until this
      // fires the entry stays "open" and Risk Guardian correctly ignores it.
      client.watchContract(contractId, (result, profit) =>
        settleTrade(id, result, profit)
      );
    } catch {
      setBlockedReason("Trade failed. Check your connection and try again.");
    }
  }

  const summary = sessionSummary(trades);

  return (
    <main className="min-h-screen bg-ink px-6 md:px-12 py-10">
      <header className="flex items-center justify-between mb-10">
        <span className="font-display font-bold text-lg">Tradezaki</span>
        <span className="font-mono text-xs text-mist">{status}</span>
      </header>

      {IS_USING_FALLBACK_APP_ID && (
        <p className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-md px-4 py-3 mb-6">
          Running on Deriv&apos;s shared test app ID (1089). Trades work, but earn
          you no markup. Set <span className="font-mono">NEXT_PUBLIC_DERIV_WS_APP_ID</span>{" "}
          to your own numeric App ID before deploying.
        </p>
      )}

      <div className="grid md:grid-cols-3 gap-6 mb-10">
        <Stat label="Balance" value={balance !== null ? `${balance.toFixed(2)} ${currency}` : "—"} />
        <Stat label="Trades today" value={String(summary.tradeCount)} />
        <Stat
          label="Win rate today"
          value={summary.tradeCount > 0 ? `${(summary.winRate * 100).toFixed(0)}%` : "—"}
        />
      </div>

      <section className="bg-panel border border-line rounded-lg p-6 max-w-md">
        <p className="font-mono text-xs text-signal uppercase tracking-wider mb-4">
          {SYMBOL} · Rise/Fall · stake {STAKE} {currency}
        </p>

        {blockedReason && (
          <p className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-md px-4 py-3 mb-4">
            {blockedReason}
          </p>
        )}

        <div className="flex gap-4">
          <button
            onClick={() => placeTrade("CALL")}
            className="flex-1 bg-signal text-ink font-medium py-3 rounded-lg hover:brightness-110 transition"
          >
            Rise
          </button>
          <button
            onClick={() => placeTrade("PUT")}
            className="flex-1 bg-danger text-ink font-medium py-3 rounded-lg hover:brightness-110 transition"
          >
            Fall
          </button>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line rounded-lg p-5 bg-panel">
      <p className="font-mono text-xs text-mist uppercase tracking-wider mb-2">{label}</p>
      <p className="font-display font-bold text-2xl">{value}</p>
    </div>
  );
}
