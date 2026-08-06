"use client";

import { useDeriv } from "@/components/DerivProvider";
import { sessionSummary } from "@tradezaki/core";
import OpenPositions from "@/components/OpenPositions";

export default function PositionsPage() {
  const { accountTrades, currency, account, openContracts } = useDeriv();

  const settled = [...accountTrades].filter((t) => t.result !== "open").reverse();
  const summary = sessionSummary(accountTrades);
  const exposure = openContracts.reduce((s, c) => s + c.buyPrice, 0);
  const running = openContracts.reduce((s, c) => s + c.profit, 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-6">
        <header className="mb-6">
          <h1 className="font-display font-bold text-2xl">Positions</h1>
          <p className="text-sm text-mist mt-1">
            {account
              ? `${account.accountType === "demo" ? "Demo" : "Real"} account ${account.accountId}`
              : "—"}
          </p>
        </header>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Stat label="Open" value={String(openContracts.length)} />
          <Stat label="Exposure" value={`${exposure.toFixed(2)} ${currency}`} />
          <Stat
            label="Running P/L"
            value={`${running >= 0 ? "+" : ""}${running.toFixed(2)}`}
            tone={running > 0 ? "up" : running < 0 ? "down" : undefined}
          />
          <Stat
            label="Net today"
            value={`${summary.netProfit >= 0 ? "+" : ""}${summary.netProfit.toFixed(2)}`}
            tone={summary.netProfit > 0 ? "up" : summary.netProfit < 0 ? "down" : undefined}
          />
        </div>

        <Section title={`Open positions (${openContracts.length})`}>
          <OpenPositions />
        </Section>

        <Section title="Settled">
          {settled.length === 0 ? (
            <Empty>No settled trades yet.</Empty>
          ) : (
            <Table
              rows={settled.slice(0, 100).map((t) => [
                t.contractType,
                t.symbol,
                `${t.stake.toFixed(2)} ${currency}`,
                <span key={t.id} className={t.profit >= 0 ? "text-signal" : "text-danger"}>
                  {t.profit >= 0 ? "+" : ""}
                  {t.profit.toFixed(2)}
                </span>,
              ])}
            />
          )}
        </Section>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="border border-line rounded-lg p-3.5 bg-panel/50">
      <p className="font-mono text-[9px] uppercase tracking-widest text-mist mb-1">{label}</p>
      <p
        className={`font-display font-bold text-xl ${
          tone === "up" ? "text-signal" : tone === "down" ? "text-danger" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="font-mono text-[10px] uppercase tracking-widest text-mist mb-2">{title}</h2>
      <div className="border border-line rounded-lg bg-panel/50 overflow-hidden">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-4 text-sm text-mist">{children}</p>;
}

function Table({ rows }: { rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] min-w-[420px]">
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-b border-line/60 last:border-0">
              {cells.map((c, j) => (
                <td
                  key={j}
                  className={`px-4 py-2.5 font-mono ${j === 0 ? "" : "text-mist"} ${
                    j === cells.length - 1 ? "text-right" : ""
                  }`}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
