"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DerivClient,
  DEFAULT_RISK_CONFIG,
  checkTradeAllowed,
  type ActiveSymbol,
  type ConnectionState,
  type ContractAvailability,
  type OpenContract,
  type ProposalRequest,
  type RiskGuardianConfig,
  type TradeLogEntry,
} from "@tradezaki/core";
import { getValidToken, SessionExpiredError } from "@/lib/session";
import { isCloudConfigured } from "@/lib/supabase";
import { loadRiskConfig, saveRiskConfig } from "@/lib/cloud";

export interface Account {
  accountId: string;
  balance: string;
  currency: string;
  accountType: string;
  status: string;
}

export interface Tick {
  quote: number;
  epoch: number;
}

const MAX_TICKS = 80;

interface DerivContextValue {
  accounts: Account[];
  account: Account | null;
  activeId: string | null;
  setActiveId: (id: string) => void;
  balance: number | null;
  currency: string;
  connState: ConnectionState;
  notice: string | null;
  dismissNotice: () => void;

  symbols: ActiveSymbol[];
  symbol: string | null;
  setSymbol: (s: string) => void;
  activeSymbol: ActiveSymbol | null;
  available: ContractAvailability[];
  ticks: Tick[];
  spot: number | null;

  trades: TradeLogEntry[];
  accountTrades: TradeLogEntry[];
  lossToday: number;

  riskConfig: RiskGuardianConfig;
  updateRisk: (c: RiskGuardianConfig) => void;

  quote: (req: Omit<ProposalRequest, "symbol" | "currency">) => Promise<
    { payout: number; askPrice: number } | { error: string }
  >;
  buy: (req: Omit<ProposalRequest, "symbol" | "currency">) => Promise<string | null>;
  busy: string | null;
  tradeError: string | null;
  clearTradeError: () => void;

  resetDemo: () => Promise<void>;
  resetting: boolean;

  /** Barrier the ticket is configured with, drawn on the chart. */
  chartBarrier: number | null;
  setChartBarrier: (v: number | null) => void;

  /** Live state of every contract still running, keyed by contract id. */
  openContracts: OpenContract[];
  sell: (contractId: number) => Promise<void>;
  selling: number | null;
  /** Short-lived confirmation shown after a trade is placed. */
  toast: { text: string; tone: "up" | "down" } | null;
}

const DerivContext = createContext<DerivContextValue | null>(null);

export function useDeriv(): DerivContextValue {
  const ctx = useContext(DerivContext);
  if (!ctx) throw new Error("useDeriv must be used inside <DerivProvider>");
  return ctx;
}

/**
 * Owns the single Deriv session for the whole app.
 *
 * This lives above the router so navigating between Trade / Positions /
 * Account does not tear down the WebSocket. Reconnecting on every page change
 * would burn an OTP each time and lose the tick stream — the terminal has to
 * feel continuous.
 */
export function DerivProvider({ children }: { children: React.ReactNode }) {
  const clientRef = useRef<DerivClient | null>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [connState, setConnState] = useState<ConnectionState>("connecting");
  const [notice, setNotice] = useState<string | null>(null);

  const [symbols, setSymbols] = useState<ActiveSymbol[]>([]);
  const [symbol, setSymbolState] = useState<string | null>(null);
  const [available, setAvailable] = useState<ContractAvailability[]>([]);
  const [ticks, setTicks] = useState<Tick[]>([]);

  const [trades, setTrades] = useState<TradeLogEntry[]>([]);
  const [riskConfig, setRiskConfig] = useState<RiskGuardianConfig>(DEFAULT_RISK_CONFIG);
  const [busy, setBusy] = useState<string | null>(null);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [chartBarrier, setChartBarrier] = useState<number | null>(null);
  const [openMap, setOpenMap] = useState<Record<number, OpenContract>>({});
  const [selling, setSelling] = useState<number | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "up" | "down" } | null>(null);

  const account = accounts.find((a) => a.accountId === activeId) ?? null;
  const activeSymbol = symbols.find((s) => s.symbol === symbol) ?? null;
  const spot = ticks.length ? ticks[ticks.length - 1].quote : null;

  // Scoped to one account: demo and real are separate money, so history, stats
  // and limits must never bleed across.
  const accountTrades = useMemo(
    () => (activeId ? trades.filter((t) => t.accountId === activeId) : []),
    [trades, activeId]
  );

  const lossToday = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return accountTrades
      .filter((t) => t.result === "lost" && t.timestamp >= start.getTime())
      .reduce((sum, t) => sum + Math.abs(t.profit), 0);
  }, [accountTrades]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- bootstrap ---------------------------------------------------------
  useEffect(() => {
    const saved = localStorage.getItem("tradezaki_trades");
    if (saved) setTrades(JSON.parse(saved));

    const lastSymbol = localStorage.getItem("tradezaki_symbol");
    if (lastSymbol) setSymbolState(lastSymbol);

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
        setConnState("offline");
        return;
      }
      setAccounts(data.accounts);
      const remembered = localStorage.getItem("tradezaki_account");
      const chosen =
        data.accounts.find((a: Account) => a.accountId === remembered) ??
        data.accounts.find((a: Account) => a.accountType === "demo") ??
        data.accounts[0];
      setActiveIdState(chosen.accountId);
    })().catch((err) => {
      setConnState("offline");
      setNotice(
        err instanceof SessionExpiredError
          ? "Your session expired. Reconnect with Deriv."
          : "Could not load your Deriv accounts."
      );
    });
  }, []);

  const setActiveId = useCallback((id: string) => {
    localStorage.setItem("tradezaki_account", id);
    setActiveIdState(id);
    setBalance(null);
    setOpenMap({}); // these belong to the account we just left
  }, []);

  const setSymbol = useCallback((s: string) => {
    localStorage.setItem("tradezaki_symbol", s);
    setSymbolState(s);
  }, []);

  // ---- per-account risk --------------------------------------------------
  //
  // Stored in both places, and that is deliberate. localStorage answers
  // instantly and works when signed out, so the limits are never missing from
  // the screen. The database is the copy that matters: it is the only one the
  // runner can see, and a limit a cloud bot cannot read is not a limit.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;

    const local = localStorage.getItem(`tradezaki_risk_${activeId}`);
    setRiskConfig(local ? { ...DEFAULT_RISK_CONFIG, ...JSON.parse(local) } : DEFAULT_RISK_CONFIG);

    if (!isCloudConfigured) return;
    void loadRiskConfig(activeId)
      .then((remote) => {
        if (cancelled || !remote) return;
        // The server's copy wins. It is what the bots obey, so showing anything
        // else would tell the user their account is protected differently than
        // it is.
        setRiskConfig(remote);
        localStorage.setItem(`tradezaki_risk_${activeId}`, JSON.stringify(remote));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const updateRisk = useCallback(
    (next: RiskGuardianConfig) => {
      setRiskConfig(next);
      if (!activeId) return;
      localStorage.setItem(`tradezaki_risk_${activeId}`, JSON.stringify(next));
      if (!isCloudConfigured) return;
      // Best effort: manual trading already has the limit applied locally, so a
      // failed sync must not block the change. It does mean cloud bots keep the
      // old limit until this succeeds, which is why it is reported.
      void saveRiskConfig(activeId, next).catch((e) =>
        setNotice(
          e instanceof Error
            ? `Limits saved on this device, but not to your account: ${e.message}`
            : "Limits saved on this device only."
        )
      );
    },
    [activeId]
  );

  // ---- connection --------------------------------------------------------
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
        setSymbolState((cur) => {
          if (cur && list.some((s) => s.symbol === cur && s.isOpen)) return cur;
          return list.find((s) => s.isOpen)?.symbol ?? null;
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      client.disconnect();
    };
  }, [activeId]);

  // ---- market data -------------------------------------------------------
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !symbol || connState !== "connected") return;
    let cancelled = false;

    setTicks([]);
    setAvailable([]);
    client
      .getContractsFor(symbol)
      .then((l) => !cancelled && setAvailable(l))
      .catch(() => {});

    // Seed from history so the chart is readable immediately rather than
    // drawing itself one tick at a time.
    client
      .getTickHistory(symbol, MAX_TICKS)
      .then((h) => {
        if (cancelled || h.length === 0) return;
        setTicks((live) => {
          // Live ticks may already have arrived; keep them and prepend history.
          const firstLive = live[0]?.epoch ?? Infinity;
          return [...h.filter((t) => t.epoch < firstLive), ...live].slice(-MAX_TICKS);
        });
      })
      .catch(() => {});

    const stop = client.subscribeTicks(symbol, (q, e) => {
      if (!cancelled) setTicks((prev) => [...prev, { quote: q, epoch: e }].slice(-MAX_TICKS));
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, [symbol, connState]);

  // ---- trades ------------------------------------------------------------
  const persist = useCallback((next: TradeLogEntry[]) => {
    localStorage.setItem("tradezaki_trades", JSON.stringify(next));
    return next;
  }, []);

  const settle = useCallback(
    (id: string, result: "won" | "lost", profit: number) => {
      setTrades((prev) => persist(prev.map((t) => (t.id === id ? { ...t, result, profit } : t))));
    },
    [persist]
  );

  const quote = useCallback<DerivContextValue["quote"]>(
    async (req) => {
      const client = clientRef.current;
      if (!client || !symbol) return { error: "Not connected" };
      try {
        const p = await client.getProposal({ ...req, symbol, currency } as ProposalRequest);
        return { payout: p.payout, askPrice: p.askPrice };
      } catch (err) {
        const msg =
          typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : "Unavailable";
        return { error: /no return/i.test(msg) ? "No return" : msg };
      }
    },
    [symbol, currency]
  );

  const buy = useCallback<DerivContextValue["buy"]>(
    async (req) => {
      const client = clientRef.current;
      if (!client || !symbol) return null;

      setTradeError(null);
      const check = checkTradeAllowed(riskConfig, accountTrades, req.amount, balance ?? 0);
      if (!check.allowed) {
        setTradeError(check.reason ?? "Blocked by Risk Guardian.");
        return null;
      }

      setBusy(req.contractType);
      try {
        const proposal = await client.getProposal({ ...req, symbol, currency } as ProposalRequest);
        // Deriv applies the app's registered markup itself — askPrice is final.
        const contractId = await client.buyContract(proposal.id, proposal.askPrice);
        const id = String(contractId);

        setTrades((prev) =>
          persist([
            ...prev,
            {
              id,
              timestamp: Date.now(),
              symbol,
              contractType: req.contractType,
              stake: req.amount,
              result: "open",
              profit: 0,
              accountId: activeId ?? "active",
            },
          ])
        );

        setToast({
          text: `${req.contractType} placed · ${req.amount.toFixed(2)} ${currency}`,
          tone: "up",
        });

        client.watchContract(contractId, (c) => {
          setOpenMap((prev) => {
            if (c.isSold) {
              const next = { ...prev };
              delete next[c.contractId];
              return next;
            }
            return { ...prev, [c.contractId]: c };
          });

          if (c.isSold) {
            settle(id, c.profit >= 0 ? "won" : "lost", c.profit);
            setToast({
              text: `${c.contractType} ${c.profit >= 0 ? "won" : "lost"} · ${
                c.profit >= 0 ? "+" : ""
              }${c.profit.toFixed(2)} ${currency}`,
              tone: c.profit >= 0 ? "up" : "down",
            });
          }
        });
        return id;
      } catch (err) {
        const msg =
          typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : "Trade failed. Check your connection and try again.";
        setTradeError(msg);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [symbol, currency, riskConfig, accountTrades, balance, activeId, persist, settle]
  );

  const sell = useCallback(async (contractId: number) => {
    const client = clientRef.current;
    if (!client) return;
    setSelling(contractId);
    try {
      const soldFor = await client.sellContract(contractId);
      setToast({ text: `Closed for ${soldFor.toFixed(2)} ${currency}`, tone: "up" });
    } catch (err) {
      const msg =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Could not close that contract.";
      setTradeError(msg);
    } finally {
      setSelling(null);
    }
  }, [currency]);

  const resetDemo = useCallback(async () => {
    if (!activeId) return;
    setResetting(true);
    try {
      const accessToken = await getValidToken();
      const r = await fetch("/api/deriv/reset-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeId, accessToken }),
      });
      if (!r.ok) setNotice((await r.json()).error ?? "Could not reset the demo balance.");
    } catch {
      setNotice("Could not reset the demo balance.");
    } finally {
      setResetting(false);
    }
  }, [activeId]);

  const value: DerivContextValue = {
    accounts,
    account,
    activeId,
    setActiveId,
    balance,
    currency,
    connState,
    notice,
    dismissNotice: () => setNotice(null),
    symbols,
    symbol,
    setSymbol,
    activeSymbol,
    available,
    ticks,
    spot,
    trades,
    accountTrades,
    lossToday,
    riskConfig,
    updateRisk,
    quote,
    buy,
    busy,
    tradeError,
    clearTradeError: () => setTradeError(null),
    resetDemo,
    resetting,
    chartBarrier,
    setChartBarrier,
    openContracts: Object.values(openMap),
    sell,
    selling,
    toast,
  };

  return <DerivContext.Provider value={value}>{children}</DerivContext.Provider>;
}
