import { NextRequest, NextResponse } from "next/server";
import { createDirectUrlProvider } from "@tradezaki/core";
import { DERIV_APP_ID } from "@/lib/derivConfig";
import { NO_SESSION, readDerivSession } from "@/lib/derivSession";

/**
 * Hands the browser an authenticated Deriv WebSocket URL.
 *
 * The access token stays on the server. What the page receives is a one-time
 * password URL that expires in 120 seconds and works once — so a leaked URL is
 * worth almost nothing, whereas a leaked token can trade until it expires.
 *
 * The token comes from the session cookie and is never accepted from the
 * client. The page receives a URL, not a credential.
 */
export async function POST(req: NextRequest) {
  const { accountId } = await req.json();

  if (!accountId) {
    return NextResponse.json({ error: "Missing accountId" }, { status: 400 });
  }

  // Read from the cookie, never from the request body. Accepting a token from
  // the client would defeat the whole point: anything able to send one could
  // trade with it.
  const session = await readDerivSession();
  if (!session) return NextResponse.json(NO_SESSION.body, NO_SESSION.init);

  try {
    const getUrl = createDirectUrlProvider({
      appId: DERIV_APP_ID,
      accessToken: session.accessToken,
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
