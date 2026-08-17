import { NextResponse } from "next/server";
import { listAccounts } from "@tradezaki/core";
import { seal, loadKey } from "@tradezaki/core/node";
import { DERIV_APP_ID } from "@/lib/derivConfig";
import { adminClient } from "@/lib/supabaseAdmin";
import { NO_SESSION, readDerivSession } from "@/lib/derivSession";

/**
 * Turns a Deriv login into a Tradezaki account, with no second signup.
 *
 * Asking users to create an email/password account on top of Deriv OAuth is
 * friction for no benefit — Deriv already proved who they are. So this mints a
 * Supabase session from the Deriv identity instead.
 *
 * The security hinge is the first step: the Deriv token is VERIFIED against
 * Deriv before any session is issued. Without that, anyone could POST a made-up
 * account id and be handed a session for someone else's data. Calling
 * /trading/v1/options/accounts proves both that the token is genuine and which
 * accounts it actually owns.
 *
 * Identity is keyed on the user's Deriv account set, not on a self-declared id.
 */

export async function POST() {
  // Taken from the session cookie the token route just set, not from the
  // request. The browser has never seen this credential and cannot send it.
  const session = await readDerivSession();
  if (!session) return NextResponse.json(NO_SESSION.body, NO_SESSION.init);

  const { accessToken, refreshToken, expiresAt } = session;

  // 1. Prove the token is real, and learn which accounts it owns.
  let accounts;
  try {
    accounts = await listAccounts({ appId: DERIV_APP_ID, accessToken });
  } catch {
    return NextResponse.json({ error: "Deriv rejected that session." }, { status: 401 });
  }
  if (accounts.length === 0) {
    return NextResponse.json({ error: "No tradable Deriv accounts." }, { status: 401 });
  }

  // A stable key for this person. Deriv account ids are permanent, and the
  // lowest sorted one stays put even if they later open more accounts.
  const identity = [...accounts.map((a) => a.accountId)].sort()[0];
  const email = `deriv.${identity.toLowerCase()}@users.tradezaki.app`;

  let admin;
  try {
    admin = adminClient();
  } catch {
    return NextResponse.json(
      { error: "Cloud features aren't configured on this deployment." },
      { status: 503 }
    );
  }

  // 2. Find or create the Supabase user for this Deriv identity.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { deriv_identity: identity },
  });

  let userId = created?.user?.id;

  if (createError) {
    // Already exists — look it up rather than treating this as a failure.
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = list?.users.find((u) => u.email === email)?.id;
  }

  if (!userId) {
    return NextResponse.json({ error: "Could not open your Tradezaki account." }, { status: 500 });
  }

  // 3. Record the Deriv accounts this user owns, so the runner knows what it
  //    may trade on. Non-secret identifiers only.
  await admin.from("deriv_accounts").upsert(
    accounts.map((a) => ({
      user_id: userId,
      account_id: a.accountId,
      account_type: a.accountType,
      currency: a.currency,
      is_active: true,
    })),
    { onConflict: "user_id,account_id" }
  );

  // 4. Seal the credentials so bots can run while the user is away.
  //    This is the moment Tradezaki starts holding a trading credential; see
  //    supabase/migrations/0002_credentials.sql for what protects it.
  try {
    const key = loadKey(process.env.DERIV_TOKEN_KEY);
    const access = seal(accessToken, key);
    const refresh = refreshToken ? seal(refreshToken, key) : null;

    await admin.from("deriv_credentials").upsert(
      {
        user_id: userId,
        access_token_enc: access.ciphertext,
        access_token_iv: access.iv,
        access_token_tag: access.tag,
        refresh_token_enc: refresh?.ciphertext ?? null,
        refresh_token_iv: refresh?.iv ?? null,
        refresh_token_tag: refresh?.tag ?? null,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  } catch {
    // Manual trading works without the vault; only cloud bots need it. Failing
    // the whole login here would break the app for a missing bot feature.
    console.warn("Credential vault unavailable — cloud bots will not run.");
  }

  // 5. Issue a session without sending an email. generateLink returns a token
  //    the browser exchanges for a real session via verifyOtp.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (linkError || !link?.properties?.hashed_token) {
    return NextResponse.json({ error: "Could not start your session." }, { status: 500 });
  }

  return NextResponse.json({
    tokenHash: link.properties.hashed_token,
    email,
  });
}
