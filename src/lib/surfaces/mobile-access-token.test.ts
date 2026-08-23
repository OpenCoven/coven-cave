import assert from "node:assert/strict";

import {
  isValidMobileAccessCredential,
  signMobileAccessToken,
  verifyMobileAccessToken,
} from "./mobile-access-token.ts";

const signingKey = ["test", "mobile", "key"].join("-");
const alternateSigningKey = ["different", "mobile", "key"].join("-");
const now = 1_800_000_000_000;

{
  const token = await signMobileAccessToken({
    secret: signingKey,
    expiresAt: now + 60_000,
    nonce: "nonce-a",
  });
  assert.match(token, /^v1\.\d+\.nonce-a\.[A-Za-z0-9_-]+$/);

  const result = await verifyMobileAccessToken(token, signingKey, now);
  assert.equal(result.ok, true);
  assert.equal(result.expiresAt, now + 60_000);
}

{
  const token = await signMobileAccessToken({
    secret: signingKey,
    expiresAt: now - 1,
    nonce: "nonce-expired",
  });

  const result = await verifyMobileAccessToken(token, signingKey, now);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "expired");
}

{
  const token = await signMobileAccessToken({
    secret: signingKey,
    expiresAt: now + 60_000,
    nonce: "nonce-secret",
  });

  const result = await verifyMobileAccessToken(token, alternateSigningKey, now);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "signature");
}

{
  const result = await verifyMobileAccessToken("not-a-token", signingKey, now);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "malformed");
}

{
  const result = await isValidMobileAccessCredential({
    supplied: signingKey,
    expectedSecret: signingKey,
    now,
  });
  assert.equal(result.ok, true);
  assert.equal(result.legacy, true);
}

{
  const token = await signMobileAccessToken({
    secret: signingKey,
    expiresAt: now + 90_000,
    nonce: "nonce-credential",
  });

  const result = await isValidMobileAccessCredential({
    supplied: token,
    expectedSecret: signingKey,
    now,
  });
  assert.equal(result.ok, true);
  assert.equal(result.legacy, false);
  assert.equal(result.expiresAt, now + 90_000);
}

console.log("mobile-access-token.test.ts OK");
