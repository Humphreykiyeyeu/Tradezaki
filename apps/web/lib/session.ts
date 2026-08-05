/**
 * Deriv session storage and refresh.
 *
 * One rule: never read the stored access token directly — call `getValidToken()`,
 * which refreshes it if it's near expiry. Reading it raw is how you end up with
 * a bot that works for an hour and then quietly stops.
 *
 * Storage is localStorage for now, which means any script on the page can read a
 * trade-capable credential. That's the known gap in PLAN.md §5; the fix is
 * httpOnly cookies, and it has to happen before real users onboard.
 */

const ACCESS_KEY = "tradezaki_active_token";
const REFRESH_KEY = "tradezaki_refresh_token";
const EXPIRY_KEY = "tradezaki_token_expires_at";

/** Refresh this far ahead of expiry, so a request in flight can't age out mid-call. */
const REFRESH_MARGIN_MS = 120_000;

export interface StoredSession {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null; // ms epoch
}

export function saveSession(s: {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
}): void {
  localStorage.setItem(ACCESS_KEY, s.accessToken);
  if (s.refreshToken) localStorage.setItem(REFRESH_KEY, s.refreshToken);
  if (s.expiresIn) {
    localStorage.setItem(EXPIRY_KEY, String(Date.now() + s.expiresIn * 1000));
  }
}

export function readSession(): StoredSession | null {
  const accessToken = localStorage.getItem(ACCESS_KEY);
  if (!accessToken) return null;
  const expiresAtRaw = localStorage.getItem(EXPIRY_KEY);
  return {
    accessToken,
    refreshToken: localStorage.getItem(REFRESH_KEY),
    expiresAt: expiresAtRaw ? Number(expiresAtRaw) : null,
  };
}

export function clearSession(): void {
  [ACCESS_KEY, REFRESH_KEY, EXPIRY_KEY].forEach((k) => localStorage.removeItem(k));
}

export class SessionExpiredError extends Error {
  constructor() {
    super("Your Deriv session expired. Please reconnect.");
    this.name = "SessionExpiredError";
  }
}

// One refresh at a time. Several callers hitting an expired token simultaneously
// would otherwise each spend the refresh token, and Deriv rotates it on use —
// so the later calls would fail with a token that's already been consumed.
let inFlight: Promise<string> | null = null;

/**
 * Returns an access token good for at least the next couple of minutes,
 * refreshing it first if necessary.
 */
export async function getValidToken(): Promise<string> {
  const session = readSession();
  if (!session) throw new SessionExpiredError();

  const stillFresh =
    session.expiresAt === null || session.expiresAt - Date.now() > REFRESH_MARGIN_MS;
  if (stillFresh) return session.accessToken;

  if (!session.refreshToken) throw new SessionExpiredError();

  if (!inFlight) {
    inFlight = (async () => {
      try {
        const res = await fetch("/api/deriv/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
        });
        const data = await res.json();
        if (!res.ok || !data.accessToken) {
          clearSession();
          throw new SessionExpiredError();
        }
        saveSession(data);
        return data.accessToken as string;
      } finally {
        inFlight = null;
      }
    })();
  }

  return inFlight;
}
