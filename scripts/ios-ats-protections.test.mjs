import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ATS regression pins (cave-kpibm). PR #3820 restored App Transport Security
// in the shipping native iOS app; its regression coverage lived in
// mobile-tailscale-native.test.mjs, which #3887's Tauri-remnant sweep
// deleted. iOS Swift is not compiled by CI, so these source-text pins are
// the only guard against ATS silently regressing to the global bypass.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const plist = await read("apps/ios/CovenCave/CovenCave/Info.plist");
const connection = await read("apps/ios/CovenCave/CovenCave/Networking/CaveConnection.swift");

// --- Info.plist: ATS stays ON, with only the local-network allowance --------
assert.match(
  plist,
  /<key>NSAppTransportSecurity<\/key>\s*<dict>[\s\S]*?<\/dict>/,
  "the shipping plist declares an ATS policy block",
);
const ats = plist.match(/<key>NSAppTransportSecurity<\/key>\s*<dict>([\s\S]*?)<\/dict>/)[1];
assert.match(
  ats,
  /<key>NSAllowsArbitraryLoads<\/key>\s*<false\/>/,
  "NSAllowsArbitraryLoads must stay false — the global ATS bypass blocks App Store review and was removed by #3820. " +
    "Note: whether ATS blocks the bare numeric-IP cleartext pairing flow (http://100.x:3000) is iOS-version-dependent " +
    "(Apple's current docs treat IPs as exception-listable, unlike the old full-exemption technote); if on-device " +
    "verification shows that flow blocked, fix the CONNECTION UX (e.g. steer to .ts.net HTTPS) — do not restore the bypass.",
);
assert.doesNotMatch(
  ats,
  /<key>NSAllowsArbitraryLoads<\/key>\s*<true\/>/,
  "the global ATS bypass must not return",
);
assert.match(
  ats,
  /<key>NSAllowsLocalNetworking<\/key>\s*<true\/>/,
  "the narrow local-networking allowance (localhost/.local) is the intended carve-out",
);
assert.doesNotMatch(
  ats,
  /NSExceptionAllowsInsecureHTTPLoads|NSThirdPartyExceptionAllowsInsecureHTTPLoads/,
  "no per-domain cleartext exceptions: .ts.net hosts are normalized to HTTPS instead",
);

// --- CaveConnection: explicit http://*.ts.net URLs upgrade to HTTPS ----------
// Tailscale Serve issues a certificate for MagicDNS hosts, so a pasted
// http://*.ts.net URL is upgraded rather than rejected by ATS (and would
// otherwise derive an insecure ws:// terminal URL).
assert.match(
  connection,
  /components\.scheme\?\.lowercased\(\) == "http",\s*components\.host\?\.lowercased\(\)\.hasSuffix\("\.ts\.net"\) == true \{\s*components\.scheme = "https"/,
  "explicit HTTP MagicDNS URLs are normalized to HTTPS before ATS sees them",
);

console.log("ios-ats-protections.test.mjs: ok");
