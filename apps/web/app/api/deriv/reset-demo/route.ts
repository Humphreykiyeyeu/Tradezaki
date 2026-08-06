import { NextRequest, NextResponse } from "next/server";
import { resetDemoBalance } from "@tradezaki/core";
import { DERIV_APP_ID } from "@/lib/derivConfig";

/** Tops a demo account back up. Deriv rejects this for real accounts itself. */
export async function POST(req: NextRequest) {
  const { accountId, accessToken } = await req.json();

  if (!accountId || !accessToken) {
    return NextResponse.json({ error: "Missing accountId or accessToken" }, { status: 400 });
  }

  try {
    await resetDemoBalance({ appId: DERIV_APP_ID, accessToken, accountId });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not reset the demo balance." }, { status: 502 });
  }
}
