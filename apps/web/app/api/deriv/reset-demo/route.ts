import { NextRequest, NextResponse } from "next/server";
import { resetDemoBalance } from "@tradezaki/core";
import { DERIV_APP_ID } from "@/lib/derivConfig";
import { NO_SESSION, readDerivSession } from "@/lib/derivSession";

/** Tops a demo account back up. Deriv rejects this for real accounts itself. */
export async function POST(req: NextRequest) {
  const { accountId } = await req.json();

  if (!accountId) {
    return NextResponse.json({ error: "Missing accountId" }, { status: 400 });
  }

  const session = await readDerivSession();
  if (!session) return NextResponse.json(NO_SESSION.body, NO_SESSION.init);

  try {
    await resetDemoBalance({ appId: DERIV_APP_ID, accessToken: session.accessToken, accountId });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not reset the demo balance." }, { status: 502 });
  }
}
