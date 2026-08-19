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
 *
 * No balances here: the accounts and their balances are listed at the top of
 * this same page, and printing them twice reads as an oversight rather than as
 * emphasis.
 */

const DERIV_PORTFOLIO = "https://home.deriv.com/dashboard/portfolio";

export default function Funding() {
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
        className="inline-block rounded-lg border border-signal/40 bg-signal/5 hover:border-signal text-signal px-3.5 py-2 text-sm transition"
      >
        Move money on Deriv ↗
      </a>
    </div>
  );
}
