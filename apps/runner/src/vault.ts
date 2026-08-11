import { open, seal, type SealedToken } from "@tradezaki/core/node";
import { config } from "./config.js";
import { db } from "./db.js";

/**
 * Reads and writes Deriv credentials, sealed.
 *
 * Every plaintext token in this process is a local — none is ever assigned to a
 * field, cached, or returned to a caller that might log it. The rule is that a
 * decrypted token lives only for the duration of the call that needs it.
 */

export interface Credentials {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
}

interface CredentialRow {
  access_token_enc: string;
  access_token_iv: string;
  access_token_tag: string;
  refresh_token_enc: string | null;
  refresh_token_iv: string | null;
  refresh_token_tag: string | null;
  expires_at: string | null;
}

function unseal(
  enc: string | null,
  iv: string | null,
  tag: string | null
): string | null {
  if (!enc || !iv || !tag) return null;
  return open({ ciphertext: enc, iv, tag } as SealedToken, config.tokenKey);
}

export async function readCredentials(userId: string): Promise<Credentials | null> {
  const { data, error } = await db
    .from("deriv_credentials")
    .select(
      "access_token_enc, access_token_iv, access_token_tag, refresh_token_enc, refresh_token_iv, refresh_token_tag, expires_at"
    )
    .eq("user_id", userId)
    .maybeSingle<CredentialRow>();

  if (error) throw new Error(`Could not read credentials: ${error.message}`);
  if (!data) return null;

  return {
    accessToken: unseal(data.access_token_enc, data.access_token_iv, data.access_token_tag)!,
    refreshToken: unseal(data.refresh_token_enc, data.refresh_token_iv, data.refresh_token_tag),
    expiresAt: data.expires_at ? Date.parse(data.expires_at) : null,
  };
}

export async function writeCredentials(
  userId: string,
  creds: Credentials
): Promise<void> {
  const access = seal(creds.accessToken, config.tokenKey);
  const refresh = creds.refreshToken ? seal(creds.refreshToken, config.tokenKey) : null;

  const { error } = await db.from("deriv_credentials").upsert(
    {
      user_id: userId,
      access_token_enc: access.ciphertext,
      access_token_iv: access.iv,
      access_token_tag: access.tag,
      refresh_token_enc: refresh?.ciphertext ?? null,
      refresh_token_iv: refresh?.iv ?? null,
      refresh_token_tag: refresh?.tag ?? null,
      expires_at: creds.expiresAt ? new Date(creds.expiresAt).toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) throw new Error(`Could not store credentials: ${error.message}`);
}

/**
 * Returns a usable access token, refreshing first if it's close to expiry.
 *
 * Deriv rotates the refresh token on use, so the new one is written back
 * immediately. Losing that write would strand the user's bots at the next
 * refresh with no way to recover except logging in again.
 */
export async function getUsableToken(userId: string): Promise<string> {
  const creds = await readCredentials(userId);
  if (!creds) throw new Error("No stored Deriv credentials for this user.");

  const margin = 120_000;
  const fresh = creds.expiresAt === null || creds.expiresAt - Date.now() > margin;
  if (fresh) return creds.accessToken;

  if (!creds.refreshToken) {
    throw new Error("The stored session expired and there is no refresh token.");
  }

  const res = await fetch("https://auth.deriv.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.derivAppId,
      refresh_token: creds.refreshToken,
    }).toString(),
  });

  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!res.ok || !body.access_token) {
    throw new Error("Deriv refused to refresh the session; the user must reconnect.");
  }

  await writeCredentials(userId, {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? creds.refreshToken,
    expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : null,
  });

  return body.access_token;
}

export async function deleteCredentials(userId: string): Promise<void> {
  await db.from("deriv_credentials").delete().eq("user_id", userId);
}
