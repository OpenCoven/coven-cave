// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serverSource = readFileSync(new URL("../../server.ts", import.meta.url), "utf8");
const helperSource = serverSource.match(
  /function shouldRejectUnauthenticatedPtyUpgrade\([\s\S]*?return accessTokenConfigured && !directLoopback;\n}/,
)?.[0];

assert.ok(helperSource, "server defines one testable PTY upgrade authentication decision");

const shouldRejectUnauthenticatedPtyUpgrade = new Function(
  `${helperSource}; return shouldRejectUnauthenticatedPtyUpgrade;`,
)();

for (const [name, input, expected] of [
  [
    "packaged sidecar rejects credential-less loopback clients",
    {
      sidecarTokenConfigured: true,
      accessTokenConfigured: false,
      tokenAuthenticated: false,
      directLoopback: true,
    },
    true,
  ],
  [
    "packaged sidecar accepts its authenticated webview",
    {
      sidecarTokenConfigured: true,
      accessTokenConfigured: false,
      tokenAuthenticated: true,
      directLoopback: true,
    },
    false,
  ],
  [
    "plain local development remains credential-less",
    {
      sidecarTokenConfigured: false,
      accessTokenConfigured: false,
      tokenAuthenticated: false,
      directLoopback: true,
    },
    false,
  ],
  [
    "access-token-only local development keeps the direct browser exemption",
    {
      sidecarTokenConfigured: false,
      accessTokenConfigured: true,
      tokenAuthenticated: false,
      directLoopback: true,
    },
    false,
  ],
  [
    "access-token-only forwarded clients still need authentication",
    {
      sidecarTokenConfigured: false,
      accessTokenConfigured: true,
      tokenAuthenticated: false,
      directLoopback: false,
    },
    true,
  ],
  [
    "allowlisted or token-authenticated forwarded clients are accepted",
    {
      sidecarTokenConfigured: true,
      accessTokenConfigured: true,
      tokenAuthenticated: true,
      directLoopback: false,
    },
    false,
  ],
] as const) {
  assert.equal(shouldRejectUnauthenticatedPtyUpgrade(input), expected, name);
}

console.log("pty-upgrade-auth.test.ts: ok");
