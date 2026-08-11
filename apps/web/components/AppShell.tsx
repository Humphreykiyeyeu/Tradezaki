"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDeriv } from "@/components/DerivProvider";
import type { ConnectionState } from "@tradezaki/core";

const NAV = [
  { href: "/trade", label: "Trade" },
  { href: "/bots", label: "Bots" },
  { href: "/positions", label: "Positions" },
  { href: "/account", label: "Account" },
];

const STATE: Record<ConnectionState, { label: string; dot: string }> = {
  connecting: { label: "Connecting", dot: "bg-alert" },
  connected: { label: "Live", dot: "bg-signal" },
  reconnecting: { label: "Reconnecting", dot: "bg-alert animate-pulse" },
  offline: { label: "Offline", dot: "bg-danger" },
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const {
    accounts,
    account,
    activeId,
    setActiveId,
    balance,
    currency,
    connState,
    notice,
    dismissNotice,
    toast,
  } = useDeriv();

  const isReal = account?.accountType === "real";

  return (
    // h-dvh + overflow-hidden: the shell owns the viewport and each pane
    // scrolls internally, which is what makes it read as a terminal rather
    // than a long page.
    <div className="h-dvh flex flex-col bg-ink text-[#E7ECE9] overflow-hidden">
      <header className="shrink-0 border-b border-line bg-panel/40 backdrop-blur">
        <div className="h-14 px-3 md:px-5 flex items-center gap-3 md:gap-6">
          <Link href="/trade" className="flex items-center gap-2 shrink-0">
            <span className="w-7 h-7 rounded-md bg-signal text-ink grid place-items-center font-display font-bold text-sm">
              T
            </span>
            <span className="font-display font-bold tracking-tight hidden sm:block">
              TRADEZAKI
            </span>
          </Link>

          <nav className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded-md text-sm transition ${
                    active
                      ? "bg-signal/10 text-signal"
                      : "text-mist hover:text-[#E7ECE9] hover:bg-line/50"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex-1" />

          <span className="hidden md:flex items-center gap-1.5 font-mono text-[11px] text-mist">
            <span className={`w-1.5 h-1.5 rounded-full ${STATE[connState].dot}`} />
            {STATE[connState].label}
          </span>

          {/* Account switch — REAL is styled as the exception, never the default. */}
          {accounts.length > 0 && (
            <div className="flex rounded-md border border-line overflow-hidden">
              {accounts.map((a) => {
                const on = a.accountId === activeId;
                const demo = a.accountType === "demo";
                return (
                  <button
                    key={a.accountId}
                    onClick={() => setActiveId(a.accountId)}
                    title={a.accountId}
                    className={`px-2.5 py-1.5 font-mono text-[11px] transition ${
                      on
                        ? demo
                          ? "bg-signal text-ink"
                          : "bg-danger text-ink"
                        : "text-mist hover:text-[#E7ECE9]"
                    }`}
                  >
                    {demo ? "DEMO" : "REAL"}
                  </button>
                );
              })}
            </div>
          )}

          <div className="text-right shrink-0">
            <p className="font-mono text-[9px] uppercase tracking-widest text-mist leading-none">
              Balance
            </p>
            <p
              className={`font-mono text-sm leading-tight ${isReal ? "text-danger" : "text-signal"}`}
            >
              {balance !== null ? `${balance.toFixed(2)} ${currency}` : "—"}
            </p>
          </div>
        </div>

        {notice && (
          <div className="px-3 md:px-5 pb-2">
            <p className="text-xs text-danger bg-danger/10 border border-danger/30 rounded-md px-3 py-2 flex items-center justify-between gap-3">
              {notice}
              <button onClick={dismissNotice} className="text-mist hover:text-[#E7ECE9] shrink-0">
                ✕
              </button>
            </p>
          </div>
        )}
      </header>

      <div className="flex-1 min-h-0">{children}</div>

      {/* Trade confirmation. Placing a trade used to give no feedback at all. */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg border font-mono text-[12px] shadow-2xl backdrop-blur ${
            toast.tone === "up"
              ? "bg-signal/15 border-signal/40 text-signal"
              : "bg-danger/15 border-danger/40 text-danger"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
