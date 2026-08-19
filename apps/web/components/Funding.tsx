"use client";

import { useDeriv } from "@/components/DerivProvider";

/**
 * Money in and out — as far as we are able to take it, which is not far, and
 * deliberately so.
 *
 * Two separate reasons this page hands off to Deriv rather than doing the work:
 *
 * 1. **The API does not offer it.** Verified against the live current Options
 *    API: `transfer_between_accounts`, `cashier deposit` and `cashier withdraw`
 *    all return `UnrecognisedRequest`, and there is no wallet, transfer or
 *    cashier endpoint under any path we could find. This API surface is trading
 *    only. Nothing here is a shortcut we chose not to take.
 *
 * 2. **We would refuse the permission even if it existed.** Moving money needs
 *    the `payments` scope. PLAN.md §7 lists a token breach as a critical risk,
 *    and the difference the scope makes is the difference between a leaked token
 *    being a trading nuisance and it being a withdrawal. The whole session was
 *    just moved into an httpOnly cookie for that reason; asking for payments
 *    would hand back more than that work removed.
 *
 * What we can honestly do is remove the confusion: show what is where, name the
 * step the user is missing, and send them straight to the right Deriv screen
 * rather than making them hunt for it.
 */

const LINKS = {
  deposit: "https://app.deriv.com/cashier/deposit",
  withdraw: "https://app.deriv.com/cashier/withdrawal",
  transfer: "https://app.deriv.com/cashier/account-transfer",
  agent: "https://app.deriv.com/cashier/payment-agent",
};

export default function Funding() {
  const { accounts, currency } = useDeriv();

  const real = accounts.filter((a) => a.accountType !== "demo");
  const realTotal = real.reduce((s, a) => s + Number(a.balance), 0);

  // The specific situation this section exists for: a funded Deriv wallet with
  // nothing in the trading account, which looks from inside the app exactly like
  // having no money at all.
  const emptyReal = real.length > 0 && realTotal < 1;

  return (
    <div>
      <h2 className="font-mono text-[10px] uppercase tracking-widest text-mist mb-2">
        Money in and out
      </h2>

      <p className="text-xs text-mist mb-4 leading-relaxed">
        Deriv holds your money, not us — we never touch your balance and cannot
        move it. Deposits, withdrawals and transfers happen on Deriv, and these
        take you straight to the right screen.
      </p>

      {emptyReal && (
        <div className="mb-4 border border-alert/30 bg-alert/5 rounded-lg p-3.5">
          <p className="text-[12px] text-alert font-medium mb-1">
            Your trading account is empty
          </p>
          <p className="text-[11px] text-mist leading-relaxed">
            Money you deposit lands in your Deriv <strong>wallet</strong> first. It
            has to be transferred to the options account before it can trade —
            depositing again will not do it. That is the step most people miss.
          </p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-2.5 mb-4">
        <Action
          href={LINKS.transfer}
          title="Transfer to trading"
          note="Wallet → options account. The step that makes a deposit usable."
          primary
        />
        <Action href={LINKS.deposit} title="Deposit" note="Card, e-wallet, crypto, bank." />
        <Action href={LINKS.withdraw} title="Withdraw" note="Out to your chosen method." />
        <Action
          href={LINKS.agent}
          title="Payment agent"
          note="Local agents, where cards are awkward."
        />
      </div>

      {real.length > 0 && (
        <div className="border border-line rounded-lg divide-y divide-line/60 overflow-hidden">
          {real.map((a) => (
            <div key={a.accountId} className="px-3.5 py-2.5 flex items-center justify-between gap-3">
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
        API does not expose wallet balances or transfers, so the amounts above are
        what is available to trade, not everything you hold.
      </p>
    </div>
  );
}

function Action({
  href,
  title,
  note,
  primary,
}: {
  href: string;
  title: string;
  note: string;
  primary?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`block rounded-lg border p-3 transition ${
        primary
          ? "border-signal/40 bg-signal/5 hover:border-signal"
          : "border-line hover:border-mist"
      }`}
    >
      <p className={`text-sm mb-0.5 ${primary ? "text-signal" : ""}`}>
        {title}
        <span className="text-mist"> ↗</span>
      </p>
      <p className="text-[11px] text-mist leading-relaxed">{note}</p>
    </a>
  );
}
