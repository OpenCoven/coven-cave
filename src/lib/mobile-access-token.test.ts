// @ts-nocheck
import assert from "node:assert/strict";
import {
  bearerToken,
  MOBILE_ACCESS_TOKEN_ENV,
  mobileAccessToken,
  tokensMatch,
} from "./mobile-access-token.ts";

process.env[MOBILE_ACCESS_TOKEN_ENV] = "  secret-token  ";
assert.equal(mobileAccessToken(), "secret-token");

assert.equal(tokensMatch("secret-token", "secret-token"), true);
assert.equal(tokensMatch("secret-token", "wrong-token"), false);
assert.equal(tokensMatch("secret-token", "secret-token-extra"), false);
assert.equal(tokensMatch("", ""), false);
assert.equal(tokensMatch("secret-token", null), false);

assert.equal(bearerToken("Bearer secret-token"), "secret-token");
assert.equal(bearerToken("bearer secret-token"), "secret-token");
assert.equal(bearerToken("Basic secret-token"), null);
assert.equal(bearerToken(null), null);
