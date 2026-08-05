"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// NOTE: the access_token ends up in localStorage here — fine for
// developing against your own account, but before real users connect,
// move this to an httpOnly cookie set by the /api/deriv/token route
// instead of returning it to client JS at all.
export default function CallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const returnedState = params.get("state");
    const oauthError = params.get("error");

    if (oauthError) {
      setError(`Deriv returned an error: ${oauthError}`);
      return;
    }

    const expectedState = sessionStorage.getItem("tradezaki_oauth_state");
    const verifier = sessionStorage.getItem("tradezaki_pkce_verifier");

    if (!code || !returnedState || !verifier) {
      setError("Missing code or verifier. Please try connecting again from the start.");
      return;
    }

    if (returnedState !== expectedState) {
      setError("State mismatch — this login attempt could not be verified. Please try again.");
      return;
    }

    fetch("/api/deriv/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, verifier }),
    })
      .then((res) => res.json())
      .then((data) => {
        // The route returns per-account trading tokens, not the raw OIDC
        // access_token — that one can't place trades.
        if (data.error || !data.accounts?.length) {
          setError(data.error ?? "Deriv returned no tradable accounts.");
          return;
        }
        sessionStorage.removeItem("tradezaki_pkce_verifier");
        sessionStorage.removeItem("tradezaki_oauth_state");
        localStorage.setItem("tradezaki_accounts", JSON.stringify(data.accounts));
        localStorage.setItem("tradezaki_active_token", data.accounts[0].token);
        router.replace("/dashboard");
      })
      .catch(() => setError("Could not reach the token endpoint. Try again."));
  }, [router]);

  return (
    <main className="min-h-screen bg-ink flex items-center justify-center">
      <p className="font-mono text-sm text-mist">
        {error ?? "Connecting your Deriv account..."}
      </p>
    </main>
  );
}
