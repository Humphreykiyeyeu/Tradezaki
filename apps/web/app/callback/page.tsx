"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { markConnected } from "@/lib/session";
import { signInWithDeriv } from "@/lib/session-cloud";

// The token route seals the credential into an httpOnly cookie and returns
// only an acknowledgement. Nothing on this page ever sees the token.
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
      .then(async (data) => {
        if (data.error || !data.ok) {
          setError(data.error ?? "Deriv did not return a session.");
          return;
        }
        sessionStorage.removeItem("tradezaki_pkce_verifier");
        sessionStorage.removeItem("tradezaki_oauth_state");
        // A hint for the UI only — the session itself is the cookie the
        // response just set.
        markConnected();

        // Opens the Tradezaki account that cloud bots need. Manual trading
        // works without it, so a failure here must not block the login.
        const cloud = await signInWithDeriv();
        if (!cloud.ok) console.warn("Cloud features unavailable:", cloud.error);

        router.replace("/trade");
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
