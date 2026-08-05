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

// Must EXACTLY match a Redirect URL registered on the app, or Deriv rejects the
// login. Registered today:
//   https://tradezaki.vercel.app/callback                        ← has /callback
//   https://tradezaki-humphreykiyeyeus-projects.vercel.app       ← bare origin
// The second has no /callback path, so it can't receive the redirect. Defaulting
// to the one that actually works.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://tradezaki.vercel.app";

export const REDIRECT_URI = `${APP_URL}/callback`;

const AUTHORIZE_ENDPOINT = "https://auth.deriv.com/oauth2/auth";
export const TOKEN_ENDPOINT = "https://auth.deriv.com/oauth2/token";

// Exchanges the OIDC access token for per-account trading tokens. This step is
// mandatory: the access token from auth.deriv.com is an *identity* token and
// cannot place trades. Endpoint confirmed from Deriv's own @deriv-com/auth-client.
export const LEGACY_TOKENS_ENDPOINT = "https://oauth.deriv.com/oauth2/legacy/tokens";

// auth.deriv.com advertises only openid/offline/offline_access in its discovery
// document — "trade" and "account_manage" are not valid scopes there. Trading
// permission comes from how the app is registered in the dashboard, not from here.
const SCOPE = "openid";

export function buildAuthorizeUrl(codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: DERIV_OAUTH_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,
    brand: "deriv",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

/**
 * Parses the account tokens returned by the legacy-token exchange, which arrive
 * as flat numbered keys: { acct1, token1, cur1, acct2, token2, cur2, ... }.
 * The classic oauth.deriv.com redirect uses this same shape, so this handles
 * both routes.
 */
export function parseAccountTokens(source: URLSearchParams | Record<string, unknown>) {
  const get = (key: string): string | null =>
    source instanceof URLSearchParams
      ? source.get(key)
      : (source[key] as string | undefined) ?? null;

  const accounts: { loginid: string; token: string; currency: string }[] = [];
  for (let i = 1; get(`acct${i}`); i += 1) {
    accounts.push({
      loginid: get(`acct${i}`)!,
      token: get(`token${i}`)!,
      currency: get(`cur${i}`) ?? "USD",
    });
  }
  return accounts;
}
