"use client";

import { useDeriv } from "@/components/DerivProvider";
import RiskSettings from "@/components/RiskSettings";
import { clearSession } from "@/lib/session";

export default function AccountPage() {
  const {
    accounts,
    account,
    activeId,
    setActiveId,
    balance,
    currency,
    riskConfig,
    updateRisk,
    lossToday,
    resetDemo,
    resetting,
  } = useDeriv();

  const isDemo = account?.accountType === "demo";

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">
        <header className="mb-6">
          <h1 className="font-display font-bold text-2xl">Account</h1>
          <p className="text-sm text-mist mt-1">
            Risk limits are set per account — demo and real never affect each other.
          </p>
        </header>

        <section className="mb-6">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-mist mb-2">
            Your Deriv accounts
          </h2>
          <div className="space-y-2">
            {accounts.map((a) => {
              const on = a.accountId === activeId;
              const demo = a.accountType === "demo";
              return (
                <button
                  key={a.accountId}
                  onClick={() => setActiveId(a.accountId)}
                  className={`w-full flex items-center justify-between gap-3 border rounded-lg px-4 py-3 transition text-left ${
                    on ? "border-signal bg-signal/5" : "border-line hover:border-mist"
                  }`}
                >
                  <span>
                    <span
                      className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                        demo ? "bg-signal/15 text-signal" : "bg-danger/15 text-danger"
                      }`}
                    >
                      {demo ? "DEMO" : "REAL"}
                    </span>
                    <span className="font-mono text-xs text-mist ml-2">{a.accountId}</span>
                  </span>
                  <span className="font-mono text-sm">
                    {on && balance !== null
                      ? balance.toFixed(2)
                      : Number(a.balance).toFixed(2)}{" "}
                    {a.currency}
                  </span>
                </button>
              );
            })}
          </div>

          {isDemo && (
            <button
              onClick={resetDemo}
              disabled={resetting}
              className="mt-3 text-xs text-mist hover:text-signal underline underline-offset-2 disabled:opacity-50"
            >
              {resetting ? "Resetting…" : "Reset demo balance"}
            </button>
          )}
        </section>

        <section className="mb-6 border border-line rounded-lg bg-panel/50 p-4">
          <RiskSettings
            config={riskConfig}
            onChange={updateRisk}
            currency={currency}
            lossToday={lossToday}
            accountLabel={
              account
                ? `${account.accountType === "demo" ? "DEMO" : "REAL"} ${account.accountId}`
                : "this account"
            }
          />
        </section>

        <section className="border border-line rounded-lg bg-panel/50 p-4">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-mist mb-3">
            Session
          </h2>
          <p className="text-xs text-mist mb-3">
            Disconnecting clears your Deriv tokens from this browser. Your trade
            history stays.
          </p>
          <button
            onClick={() => {
              clearSession();
              window.location.href = "/";
            }}
            className="text-xs border border-danger/40 text-danger hover:bg-danger/10 rounded-md px-3 py-2 transition"
          >
            Disconnect from Deriv
          </button>
        </section>
      </div>
    </div>
  );
}
