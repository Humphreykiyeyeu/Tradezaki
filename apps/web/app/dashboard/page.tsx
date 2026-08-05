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
const SYMBOL = "R_75"; // Volatility 75 Index — liquid, always-on, good default
const STAKE = 5;

interface Account {
  accountId: string;
  balance: string;
  currency: string;
  accountType: string;
  status: string;
}

export default function DashboardPage() {
  const clientRef = useRef<DerivClient | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [status, setStatus] = useState("Connecting...");
  const [account, setAccount] = useState<Account | null>(null);
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

    let client: DerivClient | null = null;

    (async () => {
      // Accounts now come from a REST call rather than the OAuth redirect.
      const res = await fetch("/api/deriv/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token }),
      });
      const data = await res.json();
      if (!res.ok || !data.accounts?.length) {
        setStatus(data.error ?? "No tradable Deriv accounts found.");
        return;
      }

      // Default to demo. Real money should be a deliberate choice the user
      // makes, never where they land by default.
      const accounts: Account[] = data.accounts;
      const chosen = accounts.find((a) => a.accountType === "demo") ?? accounts[0];
      setAccount(chosen);
      setCurrency(chosen.currency);
      setBalance(Number(chosen.balance));

      // The token stays server-side; this route returns a single-use URL that
      // expires in 120 seconds.
      client = new DerivClient(async () => {
        const r = await fetch("/api/deriv/ws-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: chosen.accountId, accessToken: token }),
        });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Could not start a trading session.");
        return body.url as string;
      });
      clientRef.current = client;

      client.onDisconnect(() => setStatus("Disconnected — reload to reconnect."));

      await client.connect();
      setStatus("Connected");
      client.subscribeBalance((bal, cur) => {
        setBalance(bal);
        setCurrency(cur);
      });
    })().catch(() => setStatus("Connection failed. Try reconnecting your account."));

    return () => client?.disconnect();
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

      // Deriv applies the app's registered markup itself, so askPrice is already
      // the full price — no headroom needed.
      const contractId = await client.buyContract(proposal.id, proposal.askPrice);
      const id = String(contractId);

      logTrade({
        id,
        timestamp: Date.now(),
        symbol: SYMBOL,
        contractType: direction,
        stake: STAKE,
        result: "open",
        profit: 0,
        accountId: account?.accountId ?? "active",
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

      {account && (
        <p className="font-mono text-xs text-mist mb-6">
          {account.accountId} ·{" "}
          <span className={account.accountType === "demo" ? "text-signal" : "text-danger"}>
            {account.accountType === "demo" ? "DEMO" : "REAL MONEY"}
          </span>
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
