// PKCE (Proof Key for Code Exchange) helpers required by Deriv's current
// OAuth2 flow at auth.deriv.com. Uses Web Crypto (crypto.getRandomValues,
// crypto.subtle) which is available in browsers and in React Native via
// a polyfill (e.g. expo-crypto / react-native-get-random-values) — flag
// that polyfill as a to-do when the mobile app gets built.

const VERIFIER_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

function randomVerifier(length = 64): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => VERIFIER_CHARS[b % VERIFIER_CHARS.length]).join("");
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  const base64 = typeof btoa !== "undefined" ? btoa(str) : Buffer.from(str, "binary").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export async function generatePkce(): Promise<PkcePair> {
  const verifier = randomVerifier();
  const challenge = await sha256Base64Url(verifier);
  return { verifier, challenge };
}

export function generateState(): string {
  return randomVerifier(24);
}
