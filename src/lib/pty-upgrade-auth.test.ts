// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serverSource = readFileSync(new URL("../../server.ts", import.meta.url), "utf8");
const helperSource = serverSource.match(
  /function shouldRejectUnauthenticatedPtyUpgrade\([\s\S]*?return sidecarTokenConfigured;\n}/,
)?.[0];

assert.ok(helperSource, "server defines one testable PTY upgrade authentication decision");

const shouldRejectUnauthenticatedPtyUpgrade = new Function(
  `${helperSource}; return shouldRejectUnauthenticatedPtyUpgrade;`,
)();

// The access token was removed from this decision (cave-f4emr), so the sidecar
// credential is the only thing left that can close the credential-less path.
// `directLoopback` is deliberately still passed in every case below even though
// the helper ignores it: cave-ruw4z removed the direct-loopback escape hatch —
// TCP loopback proves the machine, not the OS user — and these cases are what
// would catch it being reintroduced.
for (const [name, input, expected] of [
  [
    "packaged sidecar rejects credential-less loopback clients",
    {
      sidecarTokenConfigured: true,
      tokenAuthenticated: false,
      directLoopback: true,
    },
    true,
  ],
  [
    "packaged sidecar accepts its authenticated webview",
    {
      sidecarTokenConfigured: true,
      tokenAuthenticated: true,
      directLoopback: true,
    },
    false,
  ],
  [
    "plain local development remains credential-less",
    {
      sidecarTokenConfigured: false,
      tokenAuthenticated: false,
      directLoopback: true,
    },
    false,
  ],
  [
    "a server with no sidecar token no longer rejects anyone: the access token that used to close this path is gone",
    {
      sidecarTokenConfigured: false,
      tokenAuthenticated: false,
      directLoopback: false,
    },
    false,
  ],
  [
    "packaged sidecar rejects credential-less forwarded clients",
    {
      sidecarTokenConfigured: true,
      tokenAuthenticated: false,
      directLoopback: false,
    },
    true,
  ],
  [
    "token-authenticated forwarded clients are accepted",
    {
      sidecarTokenConfigured: true,
      tokenAuthenticated: true,
      directLoopback: false,
    },
    false,
  ],
] as const) {
  assert.equal(shouldRejectUnauthenticatedPtyUpgrade(input), expected, name);
}

// An access-token argument must never come back and start closing this path
// again — that credential no longer exists anywhere in the server.
assert.equal(
  shouldRejectUnauthenticatedPtyUpgrade({
    sidecarTokenConfigured: false,
    accessTokenConfigured: true,
    tokenAuthenticated: false,
  }),
  false,
  "a stray accessTokenConfigured argument has no effect on the decision",
);

console.log("pty-upgrade-auth.test.ts: ok");
