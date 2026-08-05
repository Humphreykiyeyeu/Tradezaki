"use client";

import { generatePkce, generateState } from "@tradezaki/core";
import { buildAuthorizeUrl } from "@/lib/derivConfig";

export default function LandingPage() {
  async function connectWithDeriv() {
    const { verifier, challenge } = await generatePkce();
    const state = generateState();

    // Read back on the /callback page after Deriv redirects here.
    sessionStorage.setItem("tradezaki_pkce_verifier", verifier);
    sessionStorage.setItem("tradezaki_oauth_state", state);

    window.location.href = buildAuthorizeUrl(challenge, state);
  }

  return (
    <main className="min-h-screen bg-ink flex flex-col">
      <header className="flex items-center justify-between px-6 py-6 md:px-12 border-b border-line">
        <span className="font-display font-bold text-lg tracking-tight">Tradezaki</span>
        <span className="font-mono text-xs text-mist">Built on the Deriv API</span>
      </header>

      <section className="flex-1 grid md:grid-cols-2 gap-12 px-6 md:px-12 py-16 items-center max-w-6xl mx-auto w-full">
        <div>
          <p className="font-mono text-xs text-signal tracking-widest uppercase mb-4">
            Options trading, with a guardian
          </p>
          <h1 className="font-display font-bold text-4xl md:text-5xl leading-tight mb-6">
            Your platform lets you keep clicking.
            <br />
            <span className="text-signal">Ours stops you before it costs you.</span>
          </h1>
          <p className="text-mist text-base md:text-lg mb-8 max-w-md">
            Tradezaki sits on top of your Deriv account with daily loss limits,
            cooldowns after a losing streak, and an automatic trade journal —
            none of which your trading platform will ever build for you.
          </p>
          <button
            onClick={connectWithDeriv}
            className="inline-flex items-center gap-2 bg-signal text-ink font-medium px-6 py-3 rounded-lg hover:brightness-110 transition"
          >
            Connect with Deriv
          </button>
          <p className="text-xs text-mist mt-3">
            You'll be redirected to Deriv to log in. Tradezaki never sees your password.
          </p>
        </div>

        <GuardianGraphic />
      </section>

      <section className="border-t border-line px-6 md:px-12 py-10">
        <div className="max-w-6xl mx-auto grid sm:grid-cols-3 gap-8">
          <Feature
            label="Risk guardian"
            body="Set a daily loss limit and a cooldown after consecutive losses. Enforced automatically, every trade."
          />
          <Feature
            label="Auto-journal"
            body="Every trade you place is logged for you — no spreadsheets. See your win rate by symbol and time of day."
          />
          <Feature
            label="Demo arena"
            body="Weekly demo-account leaderboards to sharpen your strategy before you risk real money."
          />
        </div>
      </section>
    </main>
  );
}

function Feature({ label, body }: { label: string; body: string }) {
  return (
    <div className="border border-line rounded-lg p-5 bg-panel">
      <p className="font-mono text-xs text-signal uppercase tracking-wider mb-2">{label}</p>
      <p className="text-sm text-mist leading-relaxed">{body}</p>
    </div>
  );
}

function GuardianGraphic() {
  return (
    <svg viewBox="0 0 420 260" className="w-full h-auto" role="img" aria-label="A trade line falling toward a guardian limit line, then stopping">
      <line x1="0" y1="70" x2="420" y2="70" stroke="#E2604F" strokeWidth="1" strokeDasharray="4 4" opacity="0.6" />
      <text x="8" y="60" fontFamily="var(--font-mono)" fontSize="11" fill="#E2604F">
        daily loss limit
      </text>
      <path
        d="M10 150 L60 130 L100 165 L140 120 L180 180 L220 100 L260 190 L300 70"
        fill="none"
        stroke="#3ED9A0"
        strokeWidth="2"
      />
      <circle cx="300" cy="70" r="5" fill="#3ED9A0" />
      <line x1="300" y1="70" x2="420" y2="70" stroke="#1F2822" strokeWidth="18" />
      <text x="310" y="45" fontFamily="var(--font-mono)" fontSize="11" fill="#8A9A93">
        guardian paused trading here
      </text>
    </svg>
  );
}
