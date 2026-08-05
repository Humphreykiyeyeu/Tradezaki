// Deriv requires TWO different identifiers. They are not interchangeable, and
// mixing them up is why login never worked:
//
//   1. OAuth2 client_id  — a string, used at auth.deriv.com to log the user in.
//   2. WebSocket app_id  — a NUMBER, used on every ws.derivws.com connection
//                          and the thing markup earnings are attributed to.
//
// Both come from your app's page in the Deriv dashboard, as separate fields.

/** OAuth2 client_id. Verified registered at auth.deriv.com. */
export const DERIV_OAUTH_CLIENT_ID = "340ceNJpp5bdPFZLJxcew";

// 1089 is Deriv's public test app_id. It connects, so it unblocks local work,
// but it is NOT your app — trades placed under it earn you no markup. Anything
// deployed must set NEXT_PUBLIC_DERIV_WS_APP_ID to your own numeric App ID.
const FALLBACK_WS_APP_ID = "1089";

export const DERIV_WS_APP_ID =
  process.env.NEXT_PUBLIC_DERIV_WS_APP_ID ?? FALLBACK_WS_APP_ID;

export const IS_USING_FALLBACK_APP_ID = DERIV_WS_APP_ID === FALLBACK_WS_APP_ID;

/**
 * Per-buy markup override, as a percentage of payout.
 *
 * Default 0 — meaning "don't send it, use the app-level markup instead". The
 * Tradezaki app is already set to 3% (the maximum) in the Deriv dashboard, which
 * applies to every contract automatically. That app-level setting is the source
 * of truth; sending a per-buy value here would only override it downward.
 *
 * Set this only when you deliberately want a *lower* markup than the app default
 * — e.g. a discounted tier later on.
 */
export const DERIV_MARKUP_PERCENTAGE = Number(
  process.env.NEXT_PUBLIC_DERIV_MARKUP_PERCENTAGE ?? "0"
);

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
