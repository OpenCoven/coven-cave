import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CAVE_HEAP_LIMIT_ENV,
  CAVE_HEAP_LIMIT_MAX_MB,
  CAVE_HEAP_LIMIT_MB,
  CAVE_HEAP_LIMIT_MIN_MB,
  heapLimitNodeArgs,
  heapLimitNodeOptions,
  parseHeapLimitMb,
  resolveHeapLimitMb,
} from "./heap-limits.mjs";

// One old-space ceiling, chosen once, and every copy of that number agrees.
//
// The assertions that matter here launch a REAL node process and ask V8 what
// limit it is actually running under. Asserting that a flag string appears in a
// script would pass just as happily against a launcher that appended the flag
// after the entry path, where node hands it to the script and the process runs
// uncapped — which is the exact bug the ordering test below rules out.

// A probe SCRIPT rather than `node -e`, because the ordering contract below can
// only be observed against a script path: with `-e` there is no script path, so
// node keeps parsing every remaining argument as a node option and a flag
// "after the entry" is still honoured. That difference is exactly what makes a
// launcher that appends the flag look fine and run uncapped.
const probe = path.join(
  os.tmpdir(),
  `cave-heap-limit-probe-${process.pid}.mjs`,
);
writeFileSync(
  probe,
  "import { getHeapStatistics } from 'node:v8';\n" +
    "process.stdout.write(String(getHeapStatistics().heap_size_limit));\n",
);
process.on("exit", () => {
  try {
    rmSync(probe, { force: true });
  } catch {
    // Best effort; the temp directory is swept anyway.
  }
});

/**
 * V8's reported heap ceiling, in MiB, for a child launched with `args`.
 *
 * `heap_size_limit` is old space PLUS the young generation, so it reads a few
 * hundred MiB above the requested old-space size; every assertion below bounds
 * it on both sides rather than pinning an exact number.
 */
const reportedLimitMb = (args, env = {}) => {
  const printed = execFileSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, [CAVE_HEAP_LIMIT_ENV]: "", NODE_OPTIONS: "", ...env },
  });
  return Math.round(Number(printed.trim()) / (1024 * 1024));
};

// --- The contract itself -----------------------------------------------------
assert.equal(
  CAVE_HEAP_LIMIT_MB,
  4096,
  "the pinned ceiling matches what mainstream 16GB+ hardware already gives V8, so pinning it cannot shrink a session that works today",
);
assert.ok(
  CAVE_HEAP_LIMIT_MIN_MB < CAVE_HEAP_LIMIT_MB && CAVE_HEAP_LIMIT_MB < CAVE_HEAP_LIMIT_MAX_MB,
  "the default has to sit inside the range an override is allowed to use",
);

// --- Resolution order --------------------------------------------------------
assert.equal(resolveHeapLimitMb({}), CAVE_HEAP_LIMIT_MB, "the pinned default when nothing overrides");
assert.equal(resolveHeapLimitMb({ [CAVE_HEAP_LIMIT_ENV]: "2048" }), 2048, "an in-range override wins");
assert.equal(
  resolveHeapLimitMb({ [CAVE_HEAP_LIMIT_ENV]: "not-a-number" }),
  CAVE_HEAP_LIMIT_MB,
  "a malformed override falls back rather than refusing to start — a typo in a shell profile must not stop the desktop app",
);
assert.equal(parseHeapLimitMb("4096mb"), null, "units are refused, not silently truncated to 4096");
assert.equal(parseHeapLimitMb("  2048  "), 2048, "surrounding whitespace is tolerated");
assert.equal(
  parseHeapLimitMb(String(CAVE_HEAP_LIMIT_MIN_MB - 1)),
  null,
  "below the floor an override would break ordinary traffic, which is worse than no cap",
);
assert.equal(parseHeapLimitMb(String(CAVE_HEAP_LIMIT_MAX_MB + 1)), null, "above any real host");

// --- NODE_OPTIONS composition ------------------------------------------------
// dev-app.sh starts the dev server through `pnpm dev`, so it cannot put a V8
// flag ahead of the entry path and has to go through NODE_OPTIONS instead.
assert.equal(
  heapLimitNodeOptions({}),
  `--max-old-space-size=${CAVE_HEAP_LIMIT_MB}`,
  "an empty environment gets exactly the ceiling",
);
assert.equal(
  heapLimitNodeOptions({ NODE_OPTIONS: "--trace-warnings" }),
  `--trace-warnings --max-old-space-size=${CAVE_HEAP_LIMIT_MB}`,
  "an operator's existing NODE_OPTIONS survives — clobbering it would silently drop their flags",
);

// --- The property: a process launched with these really is capped ------------
const shipped = reportedLimitMb([...heapLimitNodeArgs({}), probe]);
assert.ok(
  shipped >= CAVE_HEAP_LIMIT_MB && shipped < CAVE_HEAP_LIMIT_MB + 512,
  `a child launched with the shipped args reported a ${shipped}MiB ceiling against a ${CAVE_HEAP_LIMIT_MB}MiB request`,
);

// The check above would also pass on a host whose V8 default happens to land
// near 4096 even if the flag were dropped entirely. Ask for two limits nothing
// defaults to and watch the reported ceiling follow.
const small = reportedLimitMb([...heapLimitNodeArgs({ [CAVE_HEAP_LIMIT_ENV]: "512" }), probe]);
const large = reportedLimitMb([...heapLimitNodeArgs({ [CAVE_HEAP_LIMIT_ENV]: "3000" }), probe]);
assert.ok(small >= 512 && small < 1024, `a 512MiB request reported ${small}MiB`);
assert.ok(large >= 3000 && large < 3512, `a 3000MiB request reported ${large}MiB`);
assert.ok(large > small, "the reported ceiling must track the request, not the host");

// NODE_OPTIONS has to reach V8 the same way argv does; it is the only channel
// dev-app.sh has.
const viaNodeOptions = reportedLimitMb([probe], {
  NODE_OPTIONS: heapLimitNodeOptions({ [CAVE_HEAP_LIMIT_ENV]: "512" }),
});
assert.ok(
  viaNodeOptions >= 512 && viaNodeOptions < 1024,
  `NODE_OPTIONS carrying a 512MiB ceiling reported ${viaNodeOptions}MiB`,
);

// --- The ordering contract, verified against a real process ------------------
// Node only reads V8 flags that appear BEFORE the script path. A launcher that
// appends the flag runs uncapped while looking correct in every string check,
// so prove the difference is observable rather than documented.
const flagFirst = reportedLimitMb(["--max-old-space-size=512", probe]);
const ignored = reportedLimitMb([probe, "--max-old-space-size=512"]);
assert.ok(
  ignored > flagFirst,
  `a flag placed after the entry reported ${ignored}MiB, the same as one placed before it (${flagFirst}MiB) — the ordering contract heapLimitNodeArgs encodes would be untestable`,
);

// --- The launcher's own resolution -------------------------------------------
// Run the exact one-liner scripts/dev-app.sh runs, then feed its answer to a
// real node. This is the whole path from the shared contract to a running
// process, minus only the shell's env prefix.
const devApp = await readFile(new URL("./dev-app.sh", import.meta.url), "utf8");
const heapCapture = devApp.match(/^dev_node_options="\$\((node -e "[\s\S]*?")\)"$/m);
assert.ok(heapCapture, "the launcher must capture its NODE_OPTIONS from a node one-liner");
const capturedOptions = execFileSync("bash", ["-c", heapCapture[1]], {
  cwd: path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  encoding: "utf8",
  // FORCE_COLOR is what turned the port capture into ANSI-decorated garbage;
  // the same hazard applies to anything else this launcher reads back.
  env: { ...process.env, FORCE_COLOR: "3", NODE_OPTIONS: "", [CAVE_HEAP_LIMIT_ENV]: "" },
});
assert.equal(
  capturedOptions.trim(),
  `--max-old-space-size=${CAVE_HEAP_LIMIT_MB}`,
  "the launcher's own capture must be the bare ceiling even when FORCE_COLOR decorates Node's output",
);
const launcherLimit = reportedLimitMb([probe], { NODE_OPTIONS: capturedOptions.trim() });
assert.ok(
  launcherLimit >= CAVE_HEAP_LIMIT_MB && launcherLimit < CAVE_HEAP_LIMIT_MB + 512,
  `the launcher's own NODE_OPTIONS produced a ${launcherLimit}MiB ceiling`,
);

// --- Rust copy ---------------------------------------------------------------
// src-tauri cannot import this module, so it carries the same numbers and this
// fails if they drift. The Rust side has its own spawn-a-real-node test for the
// property; this only guards the duplication.
const rust = await readFile(new URL("../src-tauri/src/sidecar_heap.rs", import.meta.url), "utf8");
for (const [name, value] of [
  ["CAVE_HEAP_LIMIT_MB", CAVE_HEAP_LIMIT_MB],
  ["CAVE_HEAP_LIMIT_MIN_MB", CAVE_HEAP_LIMIT_MIN_MB],
  ["CAVE_HEAP_LIMIT_MAX_MB", CAVE_HEAP_LIMIT_MAX_MB],
]) {
  assert.match(
    rust,
    new RegExp(`const ${name}: u32 = ${value};`),
    `the Rust ${name} must match scripts/heap-limits.mjs`,
  );
}
assert.match(
  rust,
  new RegExp(`const CAVE_HEAP_LIMIT_ENV: &str = "${CAVE_HEAP_LIMIT_ENV}";`),
  "both halves must read the same override variable",
);

console.log("heap-limits.test.mjs: ok");
