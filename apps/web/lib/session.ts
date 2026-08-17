"use client";

/**
 * What the browser knows about the Deriv session — which is deliberately almost
 * nothing.
 *
 * This module used to store the access token in localStorage and hand it to
 * every call that needed it. It no longer holds a credential at all: the token
 * lives in an httpOnly cookie the page cannot read, and the API routes read it
 * server-side. Any script running on the page can still call those routes, but
 * it can no longer *steal the token and use it elsewhere* — which is the
 * difference between a bad afternoon and someone's account being drained from
 * an address we have never seen.
 *
 * All that remains here is a hint for the UI, so the app can show "connect"
 * instead of flashing a broken terminal before the first request fails. It is
 * not a security boundary and must never be treated as one — the server decides
 * whether a session exists, every time.
 */

const HINT_KEY = "tradezaki_connected";

/**
 * Keys the old localStorage session used. Removed on load, because a browser
 * that logged in before this change is still holding a live trading credential
 * — shipping the fix without clearing them would protect new users and leave
 * existing ones exactly as exposed as before.
 */
const LEGACY_KEYS = [
  "tradezaki_active_token",
  "tradezaki_refresh_token",
  "tradezaki_token_expires_at",
];

export function purgeLegacyTokens(): void {
  for (const k of LEGACY_KEYS) {
    if (localStorage.getItem(k) !== null) localStorage.removeItem(k);
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super("Your Deriv session expired. Please reconnect.");
    this.name = "SessionExpiredError";
  }
}

/** Called after a successful OAuth exchange. Records no secret. */
export function markConnected(): void {
  localStorage.setItem(HINT_KEY, "1");
}

export function looksConnected(): boolean {
  return localStorage.getItem(HINT_KEY) === "1";
}

/**
 * Signs out. The cookie can only be removed by the server, so this is a request
 * rather than a local delete.
 */
export async function endSession(): Promise<void> {
  localStorage.removeItem(HINT_KEY);
  try {
    await fetch("/api/deriv/logout", { method: "POST" });
  } catch {
    // The hint is already gone, so the UI is correct either way; the cookie
    // expires on its own.
  }
}

/** Clears the local hint only — used when a request comes back 401. */
export function forgetConnection(): void {
  localStorage.removeItem(HINT_KEY);
}
