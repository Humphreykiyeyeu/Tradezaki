import { NextRequest, NextResponse } from "next/server";
import { DERIV_OAUTH_CLIENT_ID, TOKEN_ENDPOINT } from "@/lib/derivConfig";
import { writeDerivSession } from "@/lib/derivSession";

/**
 * Exchanges the OAuth authorization code for an access token.
 *
 * The access token IS the trading credential — it goes straight into
 * `Authorization: Bearer` against api.derivws.com. There is no second exchange
 * step: an earlier version of this route posted it to
 * `oauth.deriv.com/oauth2/legacy/tokens` to get `acct1/token1` pairs, but that
 * belongs to the legacy API, which this account can no longer use.
 *
 * Runs server-side because the exchange must not happen in the browser.
 */
export async function POST(req: NextRequest) {
  const { code, verifier } = await req.json();

  if (!code || !verifier) {
    return NextResponse.json({ error: "Missing code or verifier" }, { status: 400 });
  }

  // Must be byte-identical to the redirect_uri used at authorize time, or Deriv
  // rejects the exchange. Taken from this request's own origin so the two can
  // never drift apart — the browser and this route are the same deployment.
  const redirectUri = `${req.nextUrl.origin}/callback`;

  const exchange = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: DERIV_OAUTH_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }).toString(),
  });

  const data = await exchange.json();

  if (!exchange.ok || !data.access_token) {
    return NextResponse.json(
      { error: data.error_description ?? "Token exchange failed" },
      { status: 400 }
    );
  }

  // The token stops here. It is sealed into an httpOnly cookie and the browser
  // is told only that a session exists and roughly how long it lasts — never
  // the credential itself, which is what used to end up in localStorage where
  // any script could read it.
  const res = NextResponse.json({
    ok: true,
    expiresIn: data.expires_in ?? null,
  });

  writeDerivSession(res, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
  });

  return res;
}
