import { NextResponse } from "next/server";
import { DERIV_OAUTH_CLIENT_ID, TOKEN_ENDPOINT } from "@/lib/derivConfig";
import { NO_SESSION, readDerivSession, writeDerivSession } from "@/lib/derivSession";

/**
 * Trades the stored refresh token for a new access token.
 *
 * The refresh token comes from the session cookie, never from the request. It
 * used to be accepted in the body, which meant anything able to reach this
 * route could have the server spend a token it supplied — and the response
 * handed back a fresh credential in plaintext. Now the replacement goes
 * straight back into the cookie and the caller is told only that it worked.
 *
 * Deriv rotates the refresh token on use, so the new one must be stored or the
 * next refresh fails against a token already spent.
 *
 * Note: Deriv currently issues no refresh token for this app's scopes, so in
 * practice a session lasts as long as the access token (~30 days) and this
 * route reports that it cannot renew. Kept working for when that changes.
 */
export async function POST() {
  const session = await readDerivSession();
  if (!session) return NextResponse.json(NO_SESSION.body, NO_SESSION.init);

  if (!session.refreshToken) {
    return NextResponse.json(
      { error: "This session cannot be renewed. Please reconnect." },
      { status: 401 }
    );
  }

  const exchange = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: DERIV_OAUTH_CLIENT_ID,
      refresh_token: session.refreshToken,
    }).toString(),
  });

  const data = await exchange.json();

  if (!exchange.ok || !data.access_token) {
    // The refresh token is spent or revoked — the user has to log in again.
    return NextResponse.json({ error: "Session expired. Please reconnect." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, expiresIn: data.expires_in ?? null });

  writeDerivSession(res, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? session.refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
  });

  return res;
}
