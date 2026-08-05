import { NextRequest, NextResponse } from "next/server";
import { DERIV_OAUTH_CLIENT_ID, REDIRECT_URI, TOKEN_ENDPOINT } from "@/lib/derivConfig";

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

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: DERIV_OAUTH_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });

  const data = await res.json();

  if (!res.ok || !data.access_token) {
    return NextResponse.json(
      { error: data.error_description ?? "Token exchange failed" },
      { status: 400 }
    );
  }

  // TODO(security): this token can place real-money trades and currently ends up
  // in localStorage. Move it to an httpOnly cookie set here — see PLAN.md §5.
  // refresh_token matters for the cloud runner, which needs sessions that
  // outlive a browser tab.
  return NextResponse.json({
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: data.expires_in ?? null,
  });
}
