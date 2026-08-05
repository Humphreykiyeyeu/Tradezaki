import { NextRequest, NextResponse } from "next/server";
import {
  DERIV_OAUTH_CLIENT_ID,
  LEGACY_TOKENS_ENDPOINT,
  REDIRECT_URI,
  TOKEN_ENDPOINT,
  parseAccountTokens,
} from "@/lib/derivConfig";

/**
 * Completes Deriv login. Two steps, and the second one is the part that was
 * missing:
 *
 *   1. code + verifier  →  access_token        (auth.deriv.com)
 *   2. access_token     →  per-account tokens  (/oauth2/legacy/tokens)
 *
 * Step 1's access_token is an identity token — passing it to the WebSocket's
 * `authorize` call fails. Only the step-2 tokens can trade.
 *
 * Runs server-side because the token exchange must not happen in the browser.
 */
export async function POST(req: NextRequest) {
  const { code, verifier } = await req.json();

  if (!code || !verifier) {
    return NextResponse.json({ error: "Missing code or verifier" }, { status: 400 });
  }

  const tokenRes = await fetch(TOKEN_ENDPOINT, {
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

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    return NextResponse.json(
      { error: tokenData.error_description ?? "Token exchange failed" },
      { status: 400 }
    );
  }

  const legacyRes = await fetch(LEGACY_TOKENS_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!legacyRes.ok) {
    return NextResponse.json(
      { error: "Could not retrieve trading tokens for your Deriv accounts." },
      { status: 400 }
    );
  }

  const accounts = parseAccountTokens(await legacyRes.json());

  if (accounts.length === 0) {
    return NextResponse.json(
      { error: "Deriv returned no tradable accounts for this login." },
      { status: 400 }
    );
  }

  // TODO(security): these tokens can place real-money trades. Before real users
  // onboard, set them in an httpOnly cookie here instead of returning them to
  // the browser — see the token-security note in PLAN.md §5.
  return NextResponse.json({ accounts });
}
