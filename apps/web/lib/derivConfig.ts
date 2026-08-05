// Your registered Deriv app.
export const DERIV_APP_ID = "340ceNJpp5bdPFZLJxcew";

// Deriv's OAuth2 requires an HTTPS redirect URI — no http://localhost.
// Set NEXT_PUBLIC_APP_URL in .env.local for whichever HTTPS origin you're
// testing against (your Vercel URL, or an ngrok tunnel for local dev —
// see README). Falls back to your production Vercel URL.
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://tradezaki-humphreykiyeyeus-projects.vercel.app";

export const REDIRECT_URI = `${APP_URL}/callback`;

const AUTHORIZE_ENDPOINT = "https://auth.deriv.com/oauth2/auth";
export const TOKEN_ENDPOINT = "https://auth.deriv.com/oauth2/token";

// Deriv routes you to the legacy vs. new platform based on this app_id
// param, in addition to client_id. Since Tradezaki was registered on the
// classic api.deriv.com dashboard, both use the same ID for now — confirm
// this still holds if Deriv's dashboard prompts you to re-register.
export function buildAuthorizeUrl(codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: DERIV_APP_ID,
    app_id: DERIV_APP_ID,
    redirect_uri: REDIRECT_URI,
    scope: "trade account_manage",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}
