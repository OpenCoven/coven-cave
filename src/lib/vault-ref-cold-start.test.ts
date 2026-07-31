// @ts-nocheck
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

// Regression (cave-ovps): the FIRST `op read` after app launch can exceed the
// base timeout while the CLI's session daemon spins up, so a healthy ref was
// reported "unresolved" on the first Vault query and self-healed on refresh.
// The resolver now retries exactly once — with a longer allowance — when an
// attempt is killed by the timeout (the killed attempt warms the daemon).
// Non-timeout failures (bad ref, signed out) must NOT be retried.

const home = mkdtempSync(join(tmpdir(), "cave-vault-cold-home-"));
const fakeBin = mkdtempSync(join(tmpdir(), "cave-vault-cold-bin-"));
const vaultYaml = join(home, "vault.yaml");
const coldCalls = join(home, "cold-calls");
const coldMarker = join(home, "cold-marker");
const badCalls = join(home, "bad-calls");

// Fake `op`: the FIRST Cold call (no marker yet) sleeps past the base
// window but WITHIN the retry window; later calls answer instantly. The Bad
// ref fails fast. Absolute state paths are baked in so the script needs no
// env plumbing.
//
// The sleep sits BETWEEN the two windows on purpose (cave-u5eyw). Under
// full-suite load the resolver's kill can fire before this shell even
// starts, so the killed first attempt may leave no marker — in which case
// the RETRY becomes the cold call. Both interleavings must pass:
//   marker written before the kill  → retry answers instantly;
//   shell never ran before the kill → retry sleeps 4s, still inside the 15s
//                                     retry window, and resolves.
// A sleep longer than the retry window (the old 10s vs 8s) turned that
// second interleaving into a false failure no timeout bump can outrun.
const opPath = join(fakeBin, "op");
writeFileSync(opPath, `#!/bin/sh
ref="$2"
case "$ref" in
  *Cold*)
    echo x >> "${coldCalls}"
    if [ ! -f "${coldMarker}" ]; then
      : > "${coldMarker}"
      sleep 4
    fi
    echo cold-secret
    ;;
  *)
    echo x >> "${badCalls}"
    exit 1
    ;;
esac
`);
chmodSync(opPath, 0o755);

process.env.COVEN_HOME = home;
process.env.COVEN_VAULT_FILE = vaultYaml;
process.env.COVEN_CAVE_ENV_FILE = join(home, ".env.local"); // nonexistent — isolates from the repo's .env.local
process.env.PATH = `${fakeBin}${delimiter}${process.env.PATH ?? ""}`;
// The base window is deliberately smaller than the fake op's 4s cold sleep
// (so a started first attempt is always killed) and the retry window is
// deliberately larger than it (so the retry resolves even when IT is the
// cold call — see the interleaving note above). Unlike the earlier
// 300ms/2000ms attempts, correctness no longer depends on the child winning
// a spawn race against the kill, so machine load cannot flip the outcome.
process.env.COVEN_CAVE_REF_READ_TIMEOUT_MS = "2000";
process.env.COVEN_CAVE_REF_READ_RETRY_TIMEOUT_MS = "15000";
delete process.env.COVEN_CAVE_BUNDLE;
delete process.env.COLD_START_KEY;
delete process.env.BAD_REF_KEY;

writeFileSync(vaultYaml, [
  "COLD_START_KEY:",
  '  ref: "op://Dev/Cold Item/field"',
  "BAD_REF_KEY:",
  '  ref: "op://Dev/Bad Item/field"',
  "",
].join("\n"));

const { resolveSecret } = await import("./vault.ts");

const countLines = (file) => {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
};

// 1. A cold-start timeout is retried once and resolves. Without the retry,
// the resolver reports undefined the moment the first attempt is killed —
// in EVERY interleaving — so this assertion alone stays a sharp regression
// signal for the production fix.
assert.equal(resolveSecret("COLD_START_KEY"), "cold-secret", "first read after launch survives a cold-start timeout via one retry");
// Attempt count: 2 when the killed first attempt got far enough to log
// itself, 1 when the kill won the spawn race and only the retry ran. The
// UPPER bound is the real pin — a retry loop would show 3+.
const coldAttempts = countLines(coldCalls);
assert.ok(
  coldAttempts >= 1 && coldAttempts <= 2,
  `cold ref is attempted at most twice (timed-out attempt + one retry), saw ${coldAttempts}`,
);

// 2. A fast non-timeout failure is not retried.
assert.equal(resolveSecret("BAD_REF_KEY"), undefined, "genuine failure still resolves to undefined");
assert.equal(countLines(badCalls), 1, "non-timeout failure is not retried");

rmSync(home, { recursive: true, force: true });
rmSync(fakeBin, { recursive: true, force: true });

console.log("vault-ref-cold-start.test.ts: ok");
