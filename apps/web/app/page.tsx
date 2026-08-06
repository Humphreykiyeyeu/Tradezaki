"use client";

import { useState } from "react";
import { generatePkce, generateState } from "@tradezaki/core";
import { buildAuthorizeUrl } from "@/lib/derivConfig";

export default function LandingPage() {
  const [connecting, setConnecting] = useState(false);

  async function connect() {
    setConnecting(true);
    const { verifier, challenge } = await generatePkce();
    const state = generateState();
    sessionStorage.setItem("tradezaki_pkce_verifier", verifier);
    sessionStorage.setItem("tradezaki_oauth_state", state);
    window.location.href = buildAuthorizeUrl(challenge, state);
  }

  return (
    <main className="min-h-dvh bg-ink text-[#E7ECE9] flex flex-col">
      <header className="px-5 md:px-8 h-14 flex items-center gap-2 border-b border-line">
        <span className="w-7 h-7 rounded-md bg-signal text-ink grid place-items-center font-display font-bold text-sm">
          T
        </span>
        <span className="font-display font-bold tracking-tight">TRADEZAKI</span>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-mist hidden sm:block">
          Built on the Deriv API
        </span>
      </header>

      <section className="flex-1 grid lg:grid-cols-2 gap-10 items-center px-5 md:px-8 py-14 max-w-6xl mx-auto w-full">
        <div>
          <p className="inline-flex items-center gap-2 font-mono text-[11px] text-signal border border-signal/30 bg-signal/5 rounded-full px-3 py-1 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-signal animate-pulse" />
            MARKETS LIVE
          </p>
          <h1 className="font-display font-bold text-4xl md:text-6xl leading-[1.05] tracking-tight mb-5">
            The terminal
            <br />
            synthetic indices
            <br />
            <span className="text-signal">deserved.</span>
          </h1>
          <p className="text-mist text-base leading-relaxed mb-8 max-w-md">
            Fifteen contract families, live payouts before you commit, and risk
            limits you actually control — on one screen that shows the tick, the
            price and your exposure at the same time.
          </p>

          <button
            onClick={connect}
            disabled={connecting}
            className="bg-signal text-ink font-medium px-6 py-3 rounded-lg hover:brightness-110 transition disabled:opacity-60"
          >
            {connecting ? "Redirecting to Deriv…" : "Connect with Deriv"}
          </button>
          <p className="text-[11px] text-mist mt-3">
            You log in on Deriv. Tradezaki never sees your password, and never asks
            for withdrawal permissions.
          </p>
        </div>

        <ul className="grid sm:grid-cols-2 gap-3">
          {[
            ["Every contract type", "Rise/Fall, digits, barriers, Asians, Accumulators — not just the basics."],
            ["Payouts up front", "Both sides priced live, so you know what a trade pays before you click."],
            ["Limits that are yours", "Daily loss caps and cooldowns, per account, off until you switch them on."],
            ["Demo that stays demo", "Practise freely — demo limits never touch your real account."],
          ].map(([title, body]) => (
            <li key={title} className="border border-line rounded-xl p-4 bg-panel/40">
              <p className="font-medium text-sm mb-1">{title}</p>
              <p className="text-xs text-mist leading-relaxed">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="px-5 md:px-8 py-5 border-t border-line">
        <p className="text-[11px] text-mist max-w-3xl">
          Trading involves risk and you can lose your money. Tradezaki adds a markup
          to contract prices, which is how it is funded — trades placed here cost
          more than trading directly with Deriv.
        </p>
      </footer>
    </main>
  );
}
