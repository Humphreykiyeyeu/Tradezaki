import { NextRequest, NextResponse } from "next/server";
import { DERIV_OAUTH_CLIENT_ID, TOKEN_ENDPOINT } from "@/lib/derivConfig";

/**
 * Trades a refresh token for a new access token.
 *
 * Without this, a session lasts exactly as long as the access token and then
 * dies — which is fatal for the cloud runner, whose entire promise is trading
 * unattended for days. Deriv issues a rotated refresh token on each use, so the
 * caller must store whatever comes back rather than reusing the old one.
 */
export async function POST(req: NextRequest) {
  const { refreshToken } = await req.json();

  if (!refreshToken) {
    return NextResponse.json({ error: "Missing refreshToken" }, { status: 400 });
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: DERIV_OAUTH_CLIENT_ID,
      refresh_token: refreshToken,
    }).toString(),
  });

  const data = await res.json();

  if (!res.ok || !data.access_token) {
    // The refresh token is spent or revoked — the user has to log in again.
    return NextResponse.json({ error: "Session expired. Please reconnect." }, { status: 401 });
  }

  return NextResponse.json({
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresIn: data.expires_in ?? null,
  });
}
