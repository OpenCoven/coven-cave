import assert from "node:assert/strict";

import {
  buildInviteUrl,
  createMobileInvite,
  findServeUrl,
  magicDnsHost,
  magicDnsServeUrl,
  resolveTailscaleBin,
  tailnetDiscoveryProof,
} from "./mobile-handoff.ts";
import { verifyMobileAccessToken } from "./mobile-access-token.ts";

const serveHost = "cave.tailnet.example.ts.net";
const serveUrl = `https://${serveHost}/`;

const status = {
  TCP: {
    "443": { HTTPS: true },
  },
  Web: {
    [`${serveHost}:443`]: {
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
  assert.equal(url, serveUrl);
}

{
  const url = findServeUrl(status, "http://127.0.0.1:4242");
  assert.equal(url, null);
}

{
  // Tailscale may report the proxy with a trailing slash or as `localhost`.
  const variants = {
    Web: {
      [`${serveHost}:443`]: {
        Handlers: { "/": { Proxy: "http://localhost:3000/" } },
      },
    },
  };
  assert.equal(
    findServeUrl(variants, "http://127.0.0.1:3000"),
    serveUrl,
  );
}

{
  const bin = resolveTailscaleBin({
    envBin: "/custom/tailscale",
    pathEnv: "",
    exists: (candidate) => candidate === "/custom/tailscale",
    candidatePaths: ["/Applications/Tailscale.app/Contents/MacOS/Tailscale"],
  });
  assert.equal(bin, "/custom/tailscale");
}

{
  const appBin = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
  const bin = resolveTailscaleBin({
    pathEnv: "/usr/bin:/bin",
    exists: (candidate) => candidate === appBin,
    candidatePaths: [appBin, "/usr/local/bin/tailscale"],
  });
  assert.equal(bin, appBin);
}

{
  const bin = resolveTailscaleBin({
    pathEnv: "/usr/bin:/bin",
    exists: () => false,
    candidatePaths: ["/Applications/Tailscale.app/Contents/MacOS/Tailscale"],
  });
  assert.equal(bin, "tailscale");
}

{
  const url = buildInviteUrl({
    baseUrl: serveUrl,
    mobileAccessToken: "mobile-token",
    sidecarToken: "sidecar-token",
  });
  assert.equal(
    url,
    `${serveUrl}?coven_access_token=mobile-token&covenCaveToken=sidecar-token`,
  );
}

{
  const now = 1_800_000_000_000;
  const invite = await createMobileInvite({
    baseUrl: serveUrl,
    accessSecret: signingKey,
    sidecarToken: "sidecar-a",
    ttlMs: 10 * 60 * 1000,
    now,
    nonce: "nonce-invite",
  });

  assert.equal(invite.expiresAt, now + 10 * 60 * 1000);
  assert.match(invite.url, /^https:\/\/cave\.tailnet\.example\.ts\.net\/\?coven_access_token=v1\./);
  assert.match(invite.url, /&covenCaveToken=sidecar-a$/);

  const parsed = new URL(invite.url);
  const token = parsed.searchParams.get("coven_access_token");
  assert.ok(token);
  const verification = await verifyMobileAccessToken(token, signingKey, now);
  assert.equal(verification.ok, true);

  // The native-app invite is a covencave:// deep link carrying the SERVE host
  // and a LONG-lived token (30d default, not the 8h QR TTL) — tapping it on
  // the device pairs with zero typing, and the device renews from there.
  assert.ok(invite.appInviteUrl.startsWith("covencave://connect?"));
  const app = new URL(invite.appInviteUrl);
  assert.equal(app.searchParams.get("host"), "cave.tailnet.example.ts.net");
  const appToken = app.searchParams.get("token");
  assert.ok(appToken);
  const appVerification = await verifyMobileAccessToken(appToken, signingKey, now);
  assert.equal(appVerification.ok, true);
  if (appVerification.ok) {
    assert.equal(appVerification.expiresAt, invite.appTokenExpiresAt);
    assert.ok(invite.appTokenExpiresAt > invite.expiresAt, "app token outlives the QR invite");
  }
}

{
  // MagicDNS fallback: derive the serve URL from `status --self --json` when
  // the serve config can't be read (the GUI-failed-to-start case). The root
  // dot Tailscale appends to DNSName is stripped.
  const self = { Self: { DNSName: "cave.tailnet.example.ts.net." } };
  assert.equal(magicDnsHost(self), "cave.tailnet.example.ts.net");
  assert.equal(magicDnsServeUrl(self), serveUrl);

  // The fallback host matches what findServeUrl would have produced, so the
  // invite link is well-formed either way.
  assert.equal(magicDnsServeUrl(self), findServeUrl(status, "http://127.0.0.1:3000"));
}

{
  const self = { Self: { DNSName: "cave.tailnet.example.ts.net." } };
  assert.deepEqual(
    tailnetDiscoveryProof({ selfStatus: self, serveStatus: status, backendUrl: "http://127.0.0.1:3000" }),
    {
      ok: true,
      host: "cave.tailnet.example.ts.net",
      serveUrl,
      source: "serve-status",
    },
  );
  assert.deepEqual(
    tailnetDiscoveryProof({ selfStatus: self, serveStatus: {}, backendUrl: "http://127.0.0.1:3000" }),
    {
      ok: true,
      host: "cave.tailnet.example.ts.net",
      serveUrl,
      source: "magicdns-self-status",
    },
  );
  assert.deepEqual(
    tailnetDiscoveryProof({ selfStatus: {}, serveStatus: {}, backendUrl: "http://127.0.0.1:3000" }),
    {
      ok: false,
      reason: "tailscale serve URL not found and status --self had no MagicDNS DNSName",
    },
  );
}

{
  // No DNSName → no fallback (caller then surfaces the serve error).
  assert.equal(magicDnsServeUrl(null), null);
  assert.equal(magicDnsServeUrl({}), null);
  assert.equal(magicDnsServeUrl({ Self: {} }), null);
  assert.equal(magicDnsHost({ Self: { DNSName: "  " } }), null);
}

console.log("mobile-handoff.test.ts OK");
