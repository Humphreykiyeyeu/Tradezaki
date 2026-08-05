import { NextRequest, NextResponse } from "next/server";
import { createDirectUrlProvider } from "@tradezaki/core";
import { DERIV_APP_ID } from "@/lib/derivConfig";

/**
 * Hands the browser an authenticated Deriv WebSocket URL.
 *
 * The access token stays on the server. What the page receives is a one-time
 * password URL that expires in 120 seconds and works once — so a leaked URL is
 * worth almost nothing, whereas a leaked token can trade until it expires.
 *
 * The token currently comes from the request because tokens still live in
 * localStorage (see PLAN.md §5). Once tokens move to an httpOnly cookie, read
 * it from the cookie here and stop accepting it from the client entirely.
 */
export async function POST(req: NextRequest) {
  const { accountId, accessToken } = await req.json();

  if (!accountId || !accessToken) {
    return NextResponse.json({ error: "Missing accountId or accessToken" }, { status: 400 });
  }

  try {
    const getUrl = createDirectUrlProvider({
      appId: DERIV_APP_ID,
      accessToken,
      accountId,
    });
    return NextResponse.json({ url: await getUrl() });
  } catch {
    // Deliberately vague: the upstream error can echo token details.
    return NextResponse.json(
      { error: "Could not start a trading session. Try reconnecting your account." },
      { status: 502 }
    );
  }
}
