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

// Fake `op`: the Cold ref sleeps far past every timeout on its first call
// (cold daemon) and answers instantly afterwards; the Bad ref fails fast.
// Absolute state paths are baked in so the script needs no env plumbing.
const opPath = join(fakeBin, "op");
writeFileSync(opPath, `#!/bin/sh
ref="$2"
case "$ref" in
  *Cold*)
    echo x >> "${coldCalls}"
    if [ ! -f "${coldMarker}" ]; then
      : > "${coldMarker}"
      sleep 10
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
// Tight base timeout so the cold call is killed quickly — but with enough
// headroom that the fake `op` reliably STARTS (and drops its marker) before
// the kill, even on a loaded machine. At 300ms the kill raced shell spawn +
// marker write under full-suite load: the killed first attempt left no
// marker, so the RETRY became the "cold" call, slept 10s past its own
// window, and the read resolved undefined (cave-6azx). The unfixed code
// ignores these and uses its fixed 8s timeout — the 10s sleep outlasts it,
// so this test is red without the retry.
process.env.COVEN_CAVE_REF_READ_TIMEOUT_MS = "2000";
process.env.COVEN_CAVE_REF_READ_RETRY_TIMEOUT_MS = "8000";
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

// 1. A cold-start timeout is retried once and resolves.
assert.equal(resolveSecret("COLD_START_KEY"), "cold-secret", "first read after launch survives a cold-start timeout via one retry");
assert.equal(countLines(coldCalls), 2, "cold ref was attempted exactly twice (timed-out attempt + retry)");

// 2. A fast non-timeout failure is not retried.
assert.equal(resolveSecret("BAD_REF_KEY"), undefined, "genuine failure still resolves to undefined");
assert.equal(countLines(badCalls), 1, "non-timeout failure is not retried");

rmSync(home, { recursive: true, force: true });
rmSync(fakeBin, { recursive: true, force: true });

console.log("vault-ref-cold-start.test.ts: ok");
