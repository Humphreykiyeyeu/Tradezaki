"use client";

import { useDeriv } from "@/components/DerivProvider";

/**
 * Money in and out — a signpost, not a cashier.
 *
 * Two separate reasons this hands off to Deriv rather than doing the work:
 *
 * 1. **The API does not offer it.** Verified against the live current Options
 *    API: `transfer_between_accounts`, `cashier deposit` and `cashier withdraw`
 *    all return `UnrecognisedRequest`, and no wallet, transfer or cashier path
 *    answers under `api.derivws.com`. This API surface is trading only.
 *
 * 2. **We would refuse the permission even if it existed.** Moving money needs
 *    the `payments` scope. PLAN.md §7 rates a token breach as critical, and that
 *    scope is the difference between a leaked token being a trading nuisance and
 *    it being a withdrawal from someone's bank.
 *
 * Deriv's dashboard already gathers deposit, withdrawal, transfer and payment
 * agent in one place, so this links there rather than reproducing a menu that
 * would drift out of date the moment Deriv rearranged it.
 */

const DERIV_PORTFOLIO = "https://home.deriv.com/dashboard/portfolio";

export default function Funding() {
  const { accounts, currency } = useDeriv();

  const real = accounts.filter((a) => a.accountType !== "demo");

  return (
    <div>
      <h2 className="font-mono text-[10px] uppercase tracking-widest text-mist mb-2">
        Money in and out
      </h2>

      <p className="text-xs text-mist mb-4 leading-relaxed">
        Deriv holds your money, not us — we never touch your balance and cannot
        move it. Deposits, withdrawals and transfers between your wallet and your
        trading account all happen on Deriv.
      </p>

      <a
        href={DERIV_PORTFOLIO}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block rounded-lg border border-signal/40 bg-signal/5 hover:border-signal text-signal px-3.5 py-2 text-sm transition mb-4"
      >
        Open Deriv dashboard ↗
      </a>

      {real.length > 0 && (
        <div className="border border-line rounded-lg divide-y divide-line/60 overflow-hidden">
          {real.map((a) => (
            <div
              key={a.accountId}
              className="px-3.5 py-2.5 flex items-center justify-between gap-3"
            >
              <span className="font-mono text-[11px] text-mist">{a.accountId}</span>
              <span className="font-mono text-sm">
                {Number(a.balance).toFixed(2)} {a.currency || currency}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-mist/70 mt-3 leading-relaxed">
        We can see your trading accounts but not your wallet — Deriv&apos;s trading
        API does not expose wallet balances, so the amounts above are what is
        available to trade, not everything you hold.
      </p>
    </div>
  );
}
