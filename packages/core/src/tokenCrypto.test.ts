import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { loadKey, open, redact, seal, TokenCryptoError, tokensMatch } from "./tokenCrypto";

const KEY = randomBytes(32);
const TOKEN = "pat_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0";

describe("tokenCrypto", () => {
  it("round-trips a token", () => {
    assert.equal(open(seal(TOKEN, KEY), KEY), TOKEN);
  });

  it("never produces the same ciphertext twice", () => {
    // Equal ciphertexts would mean a reused IV, which breaks GCM outright.
    const a = seal(TOKEN, KEY);
    const b = seal(TOKEN, KEY);
    assert.notEqual(a.ciphertext, b.ciphertext);
    assert.notEqual(a.iv, b.iv);
  });

  it("does not leak the token into its own ciphertext", () => {
    const sealed = seal(TOKEN, KEY);
    assert.ok(!sealed.ciphertext.includes(TOKEN.slice(0, 12)));
  });

  it("refuses the wrong key", () => {
    const sealed = seal(TOKEN, KEY);
    assert.throws(() => open(sealed, randomBytes(32)), TokenCryptoError);
  });

  it("detects a tampered ciphertext instead of returning garbage", () => {
    // This is why GCM: a modified payload must fail, not decrypt to something
    // that gets sent to Deriv as a credential.
    const sealed = seal(TOKEN, KEY);
    const bytes = Buffer.from(sealed.ciphertext, "base64");
    bytes[0] ^= 0xff;
    assert.throws(
      () => open({ ...sealed, ciphertext: bytes.toString("base64") }, KEY),
      TokenCryptoError
    );
  });

  it("detects a tampered auth tag", () => {
    const sealed = seal(TOKEN, KEY);
    const tag = Buffer.from(sealed.tag, "base64");
    tag[0] ^= 0xff;
    assert.throws(() => open({ ...sealed, tag: tag.toString("base64") }, KEY), TokenCryptoError);
  });

  it("accepts base64 and hex keys", () => {
    assert.equal(loadKey(KEY.toString("base64")).length, 32);
    assert.equal(loadKey(KEY.toString("hex")).length, 32);
  });

  it("fails loudly on a missing or short key", () => {
    // Silently padding a weak key would produce something that looks encrypted
    // and isn't.
    assert.throws(() => loadKey(undefined), TokenCryptoError);
    assert.throws(() => loadKey("too-short"), TokenCryptoError);
    assert.throws(() => loadKey(randomBytes(16).toString("base64")), TokenCryptoError);
  });

  it("compares tokens without leaking length-independent timing", () => {
    assert.equal(tokensMatch("abc", "abc"), true);
    assert.equal(tokensMatch("abc", "abd"), false);
    assert.equal(tokensMatch("abc", "abcd"), false);
  });

  it("redacts tokens for logs", () => {
    const r = redact(TOKEN);
    assert.ok(!r.includes("b2c3d4"));
    assert.ok(r.startsWith("pat_"));
  });
});
