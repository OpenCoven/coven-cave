import assert from "node:assert/strict";

import {
  MOBILE_APP_TOKEN_TTL_MS,
  appTokenTtlMs,
  refreshMobileAccessToken,
} from "./mobile-token-refresh.ts";
import { signMobileAccessToken, verifyMobileAccessToken } from "./mobile-access-token.ts";

const secret = ["refresh", "test", "secret"].join("-");
const now = 1_800_000_000_000;

// A valid signed credential rolls into a fresh 30-day token.
{
  const supplied = await signMobileAccessToken({
    secret,
    expiresAt: now + 60_000,
    nonce: "nonce-live",
  });
  const result = await refreshMobileAccessToken({ supplied, secret, now });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.expiresAt, now + MOBILE_APP_TOKEN_TTL_MS);
    const verification = await verifyMobileAccessToken(result.token, secret, now);
    assert.equal(verification.ok, true);
    if (verification.ok) assert.equal(verification.expiresAt, result.expiresAt);
  }
}

// The legacy raw secret also refreshes (it's a valid credential today), giving
// a device a path OFF the never-expiring raw secret onto expiring tokens.
{
  const result = await refreshMobileAccessToken({ supplied: secret, secret, now });
  assert.equal(result.ok, true);
}

// An expired token cannot refresh — the device must re-pair.
{
  const supplied = await signMobileAccessToken({
    secret,
    expiresAt: now - 1,
    nonce: "nonce-expired",
  });
  const result = await refreshMobileAccessToken({ supplied, secret, now });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 401);
}

// A token signed with a different secret is rejected.
{
  const supplied = await signMobileAccessToken({
    secret: ["other", "signing", "key"].join("-"),
    expiresAt: now + 60_000,
  });
  const result = await refreshMobileAccessToken({ supplied, secret, now });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 401);
}

// Missing credential and disabled gate are distinct failures.
{
  const missing = await refreshMobileAccessToken({ supplied: null, secret, now });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 401);

  const disabled = await refreshMobileAccessToken({ supplied: "anything", secret: null, now });
  assert.equal(disabled.ok, false);
  if (!disabled.ok) assert.equal(disabled.status, 503);
}

// TTL override: explicit ttlMs wins; the env fallback parses positive numbers only.
{
  const supplied = await signMobileAccessToken({ secret, expiresAt: now + 60_000 });
  const result = await refreshMobileAccessToken({ supplied, secret, now, ttlMs: 1_000 });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.expiresAt, now + 1_000);

  assert.equal(appTokenTtlMs({}), MOBILE_APP_TOKEN_TTL_MS);
  assert.equal(appTokenTtlMs({ MOBILE_APP_TOKEN_TTL_MS: "5000" }), 5_000);
  assert.equal(appTokenTtlMs({ MOBILE_APP_TOKEN_TTL_MS: "-1" }), MOBILE_APP_TOKEN_TTL_MS);
  assert.equal(appTokenTtlMs({ MOBILE_APP_TOKEN_TTL_MS: "junk" }), MOBILE_APP_TOKEN_TTL_MS);
}

console.log("mobile-token-refresh.test.ts OK");
