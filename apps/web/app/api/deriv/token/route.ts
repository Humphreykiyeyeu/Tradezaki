import { NextRequest, NextResponse } from "next/server";
import { DERIV_APP_ID, REDIRECT_URI, TOKEN_ENDPOINT } from "@/lib/derivConfig";

// Exchanges an authorization code for an access token. Deriv requires this
// call to come from a server, not the browser, so the callback page posts
// here instead of calling auth.deriv.com/oauth2/token directly.
export async function POST(req: NextRequest) {
  const { code, verifier } = await req.json();

  if (!code || !verifier) {
    return NextResponse.json({ error: "Missing code or verifier" }, { status: 400 });
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: DERIV_APP_ID,
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json({ error: data.error_description ?? "Token exchange failed" }, { status: 400 });
  }

  return NextResponse.json(data);
}
