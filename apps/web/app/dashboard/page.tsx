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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stake, setStake] = useState(1);
  const [trades, setTrades] = useState<TradeLogEntry[]>([]);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [riskConfig] = useState<RiskGuardianConfig>({
    ...DEFAULT_RISK_CONFIG,
    dailyLossLimit: 20,
    maxConsecutiveLosses: 3,
  });

  const account = accounts.find((a) => a.accountId === activeId) ?? null;
  const isReal = account?.accountType === "real";

  // Load accounts once, then default to demo. Real money should be a deliberate
  // choice, never where you land by default.
  useEffect(() => {
    const token = localStorage.getItem("tradezaki_active_token");
    if (!token) {
      setStatus("No connected account. Go back and connect with Deriv.");
      return;
    }

    const savedTrades = localStorage.getItem("tradezaki_trades");
    if (savedTrades) setTrades(JSON.parse(savedTrades));

    fetch("/api/deriv/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.accounts?.length) {
          setStatus(data.error ?? "No tradable Deriv accounts found.");
          return;
        }
        setAccounts(data.accounts);
        const demo = data.accounts.find((a: Account) => a.accountType === "demo");
        setActiveId((demo ?? data.accounts[0]).accountId);
      })
      .catch(() => setStatus("Could not load your Deriv accounts."));
  }, []);

  // Reconnect whenever the active account changes. Each connection needs its own
  // OTP — they're single-use — so switching means a fresh socket, not a re-auth.
  useEffect(() => {
    if (!activeId) return;
    const token = localStorage.getItem("tradezaki_active_token");
    if (!token) return;

    let cancelled = false;
    setStatus("Connecting...");

    const client = new DerivClient(async () => {
      const r = await fetch("/api/deriv/ws-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeId, accessToken: token }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Could not start a trading session.");
      return body.url as string;
    });
    clientRef.current = client;

    client.onDisconnect(() => {
      if (!cancelled) setStatus("Disconnected — reload to reconnect.");
    });

    client
      .connect()
      .then(() => {
        if (cancelled) return;
        setStatus("Connected");
        client.subscribeBalance((bal, cur) => {
          setBalance(bal);
          setCurrency(cur);
        });
      })
      .catch(() => {
        if (!cancelled) setStatus("Connection failed. Try reconnecting your account.");
      });

    return () => {
      cancelled = true;
      client.disconnect();
    };
  }, [activeId]);

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
    const check = checkTradeAllowed(riskConfig, trades, stake, balance ?? 0);
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
        amount: stake,
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
        stake,
        result: "open",
        profit: 0,
        accountId: account?.accountId ?? "active",
      });

      // Deriv tells us the real win/loss when the contract settles. Until this
      // fires the entry stays "open" and Risk Guardian correctly ignores it.
      client.watchContract(contractId, (result, profit) =>
        settleTrade(id, result, profit)
      );
    } catch (err) {
      // Show Deriv's own message. "InsufficientBalance" or a minimum-stake error
      // is the kind of thing you need to read verbatim, not a generic apology.
      const detail =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : null;
      setBlockedReason(detail ? `Trade failed: ${detail}` : "Trade failed. Check your connection and try again.");
    }
  }

  const summary = sessionSummary(trades);

  return (
    <main className="min-h-screen bg-ink px-6 md:px-12 py-10">
      <header className="flex items-center justify-between mb-10">
        <span className="font-display font-bold text-lg">Tradezaki</span>
        <span className="font-mono text-xs text-mist">{status}</span>
      </header>

      {accounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-6">
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
                {demo ? "DEMO" : "REAL"} · {a.accountId} · {Number(a.balance).toFixed(2)}{" "}
                {a.currency}
              </button>
            );
          })}
        </div>
      )}

      {isReal && (
        <p className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-md px-4 py-3 mb-6">
          Real money. Trades here use your actual balance — and unlike demo, they
          are the only ones that earn markup.
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
          {SYMBOL} · Rise/Fall · 5 ticks
        </p>

        <label className="block mb-4">
          <span className="font-mono text-xs text-mist uppercase tracking-wider">
            Stake ({currency})
          </span>
          <input
            type="number"
            min={0.35}
            step={0.01}
            value={stake}
            onChange={(e) => setStake(Math.max(0, Number(e.target.value)))}
            className="mt-2 w-full bg-ink border border-line rounded-md px-3 py-2 font-mono text-sm focus:border-signal focus:outline-none"
          />
          {balance !== null && stake > balance && (
            <span className="text-xs text-danger mt-1 block">
              Stake is more than your {balance.toFixed(2)} {currency} balance.
            </span>
          )}
        </label>

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
