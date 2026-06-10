import assert from "node:assert/strict";

import {
  buildInviteUrl,
  createMobileInvite,
  findServeUrl,
} from "./mobile-handoff.ts";
import { verifyMobileAccessToken } from "./mobile-access-token.ts";

const status = {
  TCP: {
    "443": { HTTPS: true },
  },
  Web: {
    "mb-black.taile46e90.ts.net:443": {
      Handlers: {
        "/": {
          Proxy: "http://127.0.0.1:3000",
        },
      },
    },
  },
};
const signingKey = ["handoff", "mobile", "key"].join("-");

{
  const url = findServeUrl(status, "http://127.0.0.1:3000");
  assert.equal(url, "https://mb-black.taile46e90.ts.net/");
}

{
  const url = findServeUrl(status, "http://127.0.0.1:4242");
  assert.equal(url, null);
}

{
  const url = buildInviteUrl({
    baseUrl: "https://mb-black.taile46e90.ts.net/",
    mobileAccessToken: "mobile-token",
    sidecarToken: "sidecar-token",
  });
  assert.equal(
    url,
    "https://mb-black.taile46e90.ts.net/?coven_access_token=mobile-token&covenCaveToken=sidecar-token",
  );
}

{
  const now = 1_800_000_000_000;
  const invite = await createMobileInvite({
    baseUrl: "https://mb-black.taile46e90.ts.net/",
    accessSecret: signingKey,
    sidecarToken: "sidecar-a",
    ttlMs: 10 * 60 * 1000,
    now,
    nonce: "nonce-invite",
  });

  assert.equal(invite.expiresAt, now + 10 * 60 * 1000);
  assert.match(invite.url, /^https:\/\/mb-black\.taile46e90\.ts\.net\/\?coven_access_token=v1\./);
  assert.match(invite.url, /&covenCaveToken=sidecar-a$/);

  const parsed = new URL(invite.url);
  const token = parsed.searchParams.get("coven_access_token");
  assert.ok(token);
  const verification = await verifyMobileAccessToken(token, signingKey, now);
  assert.equal(verification.ok, true);
}

console.log("mobile-handoff.test.ts OK");
