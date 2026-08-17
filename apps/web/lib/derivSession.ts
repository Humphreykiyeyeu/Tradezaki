import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { loadKey, open, seal, type SealedToken } from "@tradezaki/core/node";

/**
 * The Deriv session, held in an httpOnly cookie instead of localStorage.
 *
 * The access token IS the trading credential — it goes straight into an
 * `Authorization: Bearer` header and can buy real contracts. It used to be
 * returned to the browser and kept in localStorage, where any script on the
 * page could read it: a single compromised dependency, a bad ad tag, or an XSS
 * anywhere in the app was enough to drain someone's account. PLAN.md §7 lists
 * that as a critical risk, and it is the gate on letting anyone but the author
 * sign in.
 *
 * Now the token never reaches client JavaScript at all. The browser holds a
 * cookie it cannot read, and every route that needs the token reads it here,
 * server-side.
 *
 * The cookie is also **encrypted**, not merely httpOnly. httpOnly stops scripts
 * reading it; encryption means that if the value escapes some other way — a
 * proxy log, an error report, a misconfigured CDN — what leaks is ciphertext.
 * Same key as the runner's vault, so there is one secret to rotate, not two.
 *
 * Server-only by construction rather than by the `server-only` package: it
 * imports `next/headers` and `@tradezaki/core/node`, both of which fail the
 * client build outright. Importing this from a component is a build error, not
 * a silently shipped secret.
 */

const COOKIE = "tz_deriv_session";

/** Deriv issues ~30-day access tokens, so the cookie should outlive a browser restart. */
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface DerivSession {
  accessToken: string;
  refreshToken: string | null;
  /** ms epoch, or null when Deriv did not say. */
  expiresAt: number | null;
}

function key() {
  return loadKey(process.env.DERIV_TOKEN_KEY);
}

/** base64url so the value is cookie-safe without escaping. */
function encode(session: DerivSession): string {
  const k = key();
  const access = seal(session.accessToken, k);
  const refresh = session.refreshToken ? seal(session.refreshToken, k) : null;
  return Buffer.from(
    JSON.stringify({ a: access, r: refresh, e: session.expiresAt }),
    "utf8"
  ).toString("base64url");
}

function decode(raw: string): DerivSession | null {
  try {
    const k = key();
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      a: SealedToken;
      r: SealedToken | null;
      e: number | null;
    };
    return {
      accessToken: open(parsed.a, k),
      refreshToken: parsed.r ? open(parsed.r, k) : null,
      expiresAt: parsed.e,
    };
  } catch {
    // A cookie sealed under a rotated key, or tampered with, is not a session.
    // Returning null makes the caller treat it as signed out, which is right.
    return null;
  }
}

/** Reads the session, or null when there isn't a valid one. */
export async function readDerivSession(): Promise<DerivSession | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;

  const session = decode(raw);
  if (!session) return null;

  // An expired token is worse than none: it produces confusing 401s from Deriv
  // rather than a clear "reconnect" from us.
  if (session.expiresAt !== null && session.expiresAt <= Date.now()) return null;

  return session;
}

export function writeDerivSession(res: NextResponse, session: DerivSession): void {
  res.cookies.set(COOKIE, encode(session), {
    httpOnly: true,
    // Off in local development, where there is no TLS and the cookie would
    // simply never be stored.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export function clearDerivSession(res: NextResponse): void {
  res.cookies.set(COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** What every protected route says when there is no usable session. */
export const NO_SESSION = {
  body: { error: "Your Deriv session has expired. Please reconnect." },
  init: { status: 401 as const },
};
