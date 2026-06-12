// @ts-nocheck
// SSH preflight must validate the host the same way familiar-runtime does and
// must never let request data reach ssh as anything but the validated host.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const runtimeLib = await readFile(
  new URL("../../../../lib/familiar-runtime.ts", import.meta.url),
  "utf8",
);

// Host validation mirrors familiar-runtime's SAFE_SSH_HOST_RE so a host that
// passes preflight is exactly a host that can be saved on a familiar.
const hostReFrom = (text) =>
  text.match(/SAFE_SSH_HOST_RE = (\/[^/]+\/)/)?.[1] ?? null;
assert.equal(
  hostReFrom(source),
  hostReFrom(runtimeLib),
  "ssh-check host regexp must match familiar-runtime's SAFE_SSH_HOST_RE",
);

assert.match(
  source,
  /if \(!host \|\| !SAFE_SSH_HOST_RE\.test\(host\)\)/,
  "invalid hosts are rejected before any spawn",
);

assert.match(
  source,
  /"BatchMode=yes"/,
  "ssh runs in BatchMode so a password prompt can never hang the server",
);

assert.match(
  source,
  /"--",\s*\n\s*host,/,
  "host is passed after `--` so it can never be parsed as an ssh option",
);

assert.match(
  source,
  /const probe = `echo \$\{PROBE_MARKER\} && \(command -v coven \|\| echo no-coven\)`/,
  "remote probe is a fixed string — no request data is interpolated",
);

assert.match(
  source,
  /accept the host key/,
  "unreachable hosts get a hint about the one-time interactive ssh handshake",
);

assert.match(
  source,
  /npm i -g @opencoven\/cli@latest/,
  "reachable hosts without coven get the remote install command",
);

console.log("onboarding ssh-check route.test.ts: ok");
