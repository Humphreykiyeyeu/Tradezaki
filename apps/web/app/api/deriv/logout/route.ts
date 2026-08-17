import { NextResponse } from "next/server";
import { clearDerivSession } from "@/lib/derivSession";

/**
 * Ends the Deriv session.
 *
 * Needed because the session now lives in an httpOnly cookie: the page cannot
 * delete what it cannot read, so signing out has to be a request to the server.
 */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearDerivSession(res);
  return res;
}
