import assert from "node:assert/strict";
import { pickVersionLine } from "./harness-version.ts";

// OpenCode prints an FZF warning to stderr before its version — the warning
// must not be captured as the "version".
assert.equal(
  pickVersionLine(
    "2026/07/12 11:01:30 WARN FZF not found in $PATH. Some features might be limited or slower.\nopencode 0.4.2",
  ),
  "opencode 0.4.2",
  "skips a timestamped WARN log line and returns the real version",
);

// Bracketed level tokens are also noise.
assert.equal(
  pickVersionLine("[warn] slow start\nsome-tool v1.2.3"),
  "some-tool v1.2.3",
  "skips a [warn] bracketed log line",
);

// Level-prefixed lines (no timestamp) are noise too.
assert.equal(
  pickVersionLine("INFO booting\nERROR transient\ncli 2.0.0"),
  "cli 2.0.0",
  "skips INFO/ERROR prefixed lines and returns the first version-like line",
);

// Normal single-line version output is unchanged.
assert.equal(
  pickVersionLine("codex-cli 0.143.0-alpha.28"),
  "codex-cli 0.143.0-alpha.28",
  "returns a normal single-line version verbatim",
);

// Leading/trailing blank lines are trimmed away.
assert.equal(
  pickVersionLine("\n\n  claude 2.1.185  \n"),
  "claude 2.1.185",
  "trims surrounding whitespace/blank lines",
);

// If nothing looks like a version, fall back to the first non-noise line
// rather than returning noise or null.
assert.equal(
  pickVersionLine("WARN something\nunknown build"),
  "unknown build",
  "falls back to the first non-noise line when no digit-bearing line exists",
);

// Empty output stays null.
assert.equal(pickVersionLine("   \n  \n"), null, "empty output returns null");

console.log("harness-version.test.ts (pickVersionLine): ok");
