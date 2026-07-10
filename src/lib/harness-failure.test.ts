// @ts-nocheck
import assert from "node:assert/strict";
import {
  harnessFixCommand,
  harnessSwitchTargets,
  parseHarnessAuthFailure,
  parseHarnessFailure,
} from "./harness-failure.ts";

// ── The canonical daemon message ─────────────────────────────────────────────
{
  const text =
    "unsupported harness `copilot`. Configured harnesses: codex, claude. " +
    "To use Hermes, run `coven adapter install hermes`, then `coven adapter doctor hermes`. " +
    "For other external harnesses, create a trusted adapter manifest under COVEN_HOME/adapters " +
    "or set COVEN_HARNESS_ADAPTER_MANIFEST / COVEN_HARNESS_ADAPTER_DIRS before starting Coven.";
  const failure = parseHarnessFailure(text);
  assert.ok(failure, "the canonical unsupported-harness message must be detected");
  assert.equal(failure.harness, "copilot");
  assert.equal(failure.harnessLabel, "Copilot");
  assert.deepEqual(failure.configured, ["codex", "claude"], "configured list parsed and canonicalized");
  assert.deepEqual(
    failure.commands,
    ["coven adapter install hermes", "coven adapter doctor hermes"],
    "quoted coven adapter commands captured in order",
  );
  assert.equal(
    harnessFixCommand(failure),
    "coven adapter install hermes && coven adapter doctor hermes",
    "fix command chains install + doctor",
  );
  const targets = harnessSwitchTargets(failure);
  assert.deepEqual(
    targets,
    [
      { id: "codex", label: "Codex" },
      { id: "claude", label: "Claude Code" },
    ],
    "switch targets are the configured harnesses with catalog labels",
  );
}

// ── The board route's wrapped variant still parses (embedded daemon detail) ──
{
  const failure = parseHarnessFailure(
    "This familiar uses the 'copilot' harness, which the daemon doesn't start as a task session. " +
      "Reassign the card to a familiar with a daemon-supported harness, or use the regular Chat " +
      "surface (daemon detail: unsupported harness `copilot`. Configured harnesses: codex, claude.).",
  );
  assert.ok(failure);
  assert.equal(failure.harness, "copilot");
  assert.deepEqual(failure.configured, ["codex", "claude"]);
}

// ── Alias + "not configured" phrasing canonicalize ───────────────────────────
{
  const failure = parseHarnessFailure("harness `claude-code` is not configured on this daemon");
  assert.ok(failure);
  assert.equal(failure.harness, "claude", "aliases map to canonical adapter ids");
  assert.deepEqual(failure.configured, []);
  const targets = harnessSwitchTargets(failure);
  assert.ok(targets.length > 0, "without a configured list, other chat adapters are offered");
  assert.ok(!targets.some((t) => t.id === "claude"), "the failed harness is never offered");
  assert.ok(targets.length <= 3, "switch targets are capped");
}

// ── Missing adapter binary reads as a runtime failure ────────────────────────
{
  const failure = parseHarnessFailure("Error: spawn codex ENOENT");
  assert.ok(failure, "a known adapter binary ENOENT is a harness failure");
  assert.equal(failure.harness, "codex");
  assert.ok(parseHarnessFailure("/bin/sh: hermes: command not found"));
  assert.equal(parseHarnessFailure("zsh: command not found: claude")?.harness, "claude");
}

// ── Non-harness errors stay null (no false positives) ────────────────────────
{
  assert.equal(parseHarnessFailure(null), null);
  assert.equal(parseHarnessFailure(""), null);
  assert.equal(parseHarnessFailure("project access denied for /tmp/foo"), null);
  assert.equal(
    parseHarnessFailure("Error: spawn ffmpeg ENOENT"),
    null,
    "an unknown binary's ENOENT is not a harness failure",
  );
  assert.equal(
    parseHarnessFailure("bash: rg: command not found"),
    null,
    "a random missing tool is not a harness failure",
  );
  assert.equal(
    parseHarnessFailure("run `coven adapter install hermes` for docs"),
    null,
    "a quoted command alone (no failed harness, no configured list) is not a failure",
  );
}

// ── Junk in the configured list is dropped, duplicates collapse ──────────────
{
  const failure = parseHarnessFailure(
    "unsupported harness `mystery`. Configured harnesses: codex, codex, weird-thing, claude",
  );
  assert.ok(failure);
  assert.equal(failure.harness, "mystery", "unknown harness ids pass through raw");
  assert.equal(failure.harnessLabel, "mystery", "unknown ids label as themselves");
  assert.deepEqual(failure.configured, ["codex", "claude"], "untrusted entries and dupes drop out");
}

// ── Runtime auth failures (cave-f6ol) ─────────────────────────────────────────
{
  const auth = parseHarnessAuthFailure("Error: not logged in. Please run /login to continue.", "claude");
  assert.ok(auth, "claude sign-in failure detected");
  assert.equal(auth.harness, "claude");
  assert.equal(auth.loginCommand, "claude /login", "claude login command offered");

  const codex = parseHarnessAuthFailure("stream error: invalid API key — run `codex login`", "codex");
  assert.ok(codex);
  assert.equal(codex.loginCommand, "codex login");

  const unknownRuntime = parseHarnessAuthFailure("authentication required", "mystery-harness");
  assert.ok(unknownRuntime, "auth failure still detected without a known runtime");
  assert.equal(unknownRuntime.harness, null, "unknown runtime ids don't map");
  assert.equal(unknownRuntime.loginCommand, null, "no command invented for unknown runtimes");

  assert.equal(
    parseHarnessAuthFailure("request failed (401): unauthorized", "claude"),
    null,
    "a bare access-gate 'unauthorized' is NOT a runtime sign-in failure",
  );
  assert.equal(
    parseHarnessAuthFailure("spawn claude ENOENT", "claude"),
    null,
    "a missing binary is a harness failure, not an auth failure",
  );
}

console.log("harness-failure.test.ts: ok");
