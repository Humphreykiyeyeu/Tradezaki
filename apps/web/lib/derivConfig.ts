// There is ONE app identifier, and it is a string. The earlier hunt for a
// "numeric App ID" was chasing a value that doesn't exist for this account:
// it has been migrated to Deriv's current Options API, where the app ID is sent
// as the `Deriv-App-ID` HTTP header rather than a query parameter.
//
// (Confirmed via GET /trading/v1/options/legacy/migration-status → "complete".)
export const DERIV_APP_ID = "340ceNJpp5bdPFZLJxcew";

/** Also the OAuth2 client_id at auth.deriv.com — same value, both roles. */
export const DERIV_OAUTH_CLIENT_ID = DERIV_APP_ID;

/**
 * Markup is configured on the app itself in the Deriv dashboard — currently 3%,
 * the maximum — and Deriv applies it to every contract automatically. It is not
 * a request parameter: sending `app_markup_percentage` on `proposal` is rejected
 * outright ("Properties not allowed").
 *
 * Exported for display only. Read what it actually earned from
 * GET /applications/v1/markup-statistics.
 */
export const DERIV_MARKUP_PERCENTAGE = 3;

/**
 * Where Deriv sends the user back to.
 *
 * Derived from the browser's own origin rather than an environment variable.
 * This used to be NEXT_PUBLIC_APP_URL, which meant a typo pointed logins at
 * someone else's domain — it was once set to the Supabase URL, and Deriv
 * dutifully redirected to a page that didn't exist. The app always knows where
 * it is running; asking a human to restate it was the mistake.
 *
 * The origin must still be registered on the Deriv app, but it can no longer
 * disagree with reality.
 */
export function redirectUri(): string {
  if (typeof window !== "undefined") return `${window.location.origin}/callback`;
  // Server-side rendering has no origin. Callers that need it on the server
  // read it from the request instead — see the token route.
  return "https://tradezaki.vercel.app/callback";
}

const AUTHORIZE_ENDPOINT = "https://auth.deriv.com/oauth2/auth";
export const TOKEN_ENDPOINT = "https://auth.deriv.com/oauth2/token";

// `trade` is what Deriv's own working template ships with in production
// (NEXT_PUBLIC_DERIV_OAUTH_SCOPES=trade). Note that auth.deriv.com's OIDC
// discovery document lists only openid/offline/offline_access — it does not
// advertise Deriv's own scopes, so don't trust it as the source of truth here.
// Using `openid` yields a token that cannot trade.
const SCOPE = process.env.NEXT_PUBLIC_DERIV_OAUTH_SCOPES ?? "trade";

export function buildAuthorizeUrl(codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: DERIV_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri(),
    scope: SCOPE,
    state,
    brand: "deriv",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

// NOTE: the old `acct1/token1/cur1` parsing is gone. That shape belongs to the
// legacy API. On the current one the OAuth `access_token` is used directly as a
// Bearer token, and accounts come from GET /trading/v1/options/accounts.
