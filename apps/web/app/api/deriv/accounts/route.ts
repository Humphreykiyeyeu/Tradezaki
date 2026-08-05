import { NextRequest, NextResponse } from "next/server";
import { listAccounts } from "@tradezaki/core";
import { DERIV_APP_ID } from "@/lib/derivConfig";

/**
 * Lists the Deriv accounts this token can trade, with live balances.
 *
 * Replaces the old `acct1/token1/cur1` parsing: on the current API, accounts
 * come from a REST call rather than being packed into the OAuth redirect, and
 * each account is addressed by its `account_id` (e.g. "DOT93366786").
 */
export async function POST(req: NextRequest) {
  const { accessToken } = await req.json();

  if (!accessToken) {
    return NextResponse.json({ error: "Missing accessToken" }, { status: 400 });
  }

  try {
    const accounts = await listAccounts({ appId: DERIV_APP_ID, accessToken });
    return NextResponse.json({ accounts });
  } catch {
    return NextResponse.json(
      { error: "Could not load your Deriv accounts. Try reconnecting." },
      { status: 502 }
    );
  }
}
