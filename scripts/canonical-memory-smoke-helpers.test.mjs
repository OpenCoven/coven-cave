import assert from "node:assert/strict";
import path from "node:path";

const helpers = await import("./canonical-memory-smoke-helpers.mjs").catch(
  () => ({}),
);

assert.equal(
  typeof helpers.isPathWithinRoot,
  "function",
  "the smoke harness exposes a pure path-containment helper",
);

const fixtureRoot = path.resolve(
  path.sep,
  "synthetic",
  "home",
);

assert.equal(helpers.isPathWithinRoot(fixtureRoot, fixtureRoot), true);
assert.equal(
  helpers.isPathWithinRoot(
    fixtureRoot,
    path.join(fixtureRoot, "memory", "note.md"),
  ),
  true,
);
assert.equal(
  helpers.isPathWithinRoot(
    fixtureRoot,
    path.resolve(fixtureRoot, "..", "home-sibling", "note.md"),
  ),
  false,
  "a sibling sharing the root string prefix is outside",
);
assert.equal(
  helpers.isPathWithinRoot(
    fixtureRoot,
    path.resolve(fixtureRoot, "..", "outside.md"),
  ),
  false,
);
assert.equal(
  helpers.isPathWithinRoot(fixtureRoot, path.parse(fixtureRoot).root),
  false,
  "an absolute relative result is outside",
);

assert.equal(
  typeof helpers.classifyMemoryOpenProbe,
  "function",
  "the smoke harness exposes a pure CLI probe classifier",
);

const memoryOpenProbeCases = [
  {
    name: "available",
    result: {
      kind: "exit",
      code: 0,
      signal: null,
      stdout: "Usage: coven memory open",
      stderr: "",
    },
    expected: "available",
  },
  {
    name: "recognized missing command",
    result: {
      kind: "exit",
      code: 2,
      signal: null,
      stdout: "",
      stderr: "error: unrecognized subcommand 'open'",
    },
    expected: "missing",
  },
  {
    name: "recognized missing parent command",
    result: {
      kind: "exit",
      code: 2,
      signal: null,
      stdout: "",
      stderr: "error: unknown command `memory`",
    },
    expected: "missing",
  },
  {
    name: "recognized current clap unexpected open",
    result: {
      kind: "exit",
      code: 2,
      signal: null,
      stdout: "",
      stderr: [
        "error: unexpected argument 'open' found",
        "",
        "Usage: coven memory [OPTIONS]",
      ].join("\n"),
    },
    expected: "missing",
  },
  {
    name: "unexpected open without memory usage context",
    result: {
      kind: "exit",
      code: 2,
      signal: null,
      stdout: "",
      stderr: "error: unexpected argument 'open' found",
    },
    expected: "failed",
  },
  {
    name: "memory usage context without unexpected open",
    result: {
      kind: "exit",
      code: 2,
      signal: null,
      stdout: "",
      stderr: "Usage: coven memory [OPTIONS]",
    },
    expected: "failed",
  },
  {
    name: "generic unexpected argument with memory usage context",
    result: {
      kind: "exit",
      code: 2,
      signal: null,
      stdout: "",
      stderr: [
        "error: unexpected argument 'other' found",
        "",
        "Usage: coven memory [OPTIONS]",
      ].join("\n"),
    },
    expected: "failed",
  },
  {
    name: "unexpected open with wrong usage context",
    result: {
      kind: "exit",
      code: 2,
      signal: null,
      stdout: "",
      stderr: [
        "error: unexpected argument 'open' found",
        "",
        "Usage: coven agent [OPTIONS]",
      ].join("\n"),
    },
    expected: "failed",
  },
  {
    name: "current clap wording with runtime exit code",
    result: {
      kind: "exit",
      code: 1,
      signal: null,
      stdout: "",
      stderr: [
        "error: unexpected argument 'open' found",
        "Usage: coven memory [OPTIONS]",
      ].join("\n"),
    },
    expected: "failed",
  },
  {
    name: "current clap wording with signal",
    result: {
      kind: "exit",
      code: null,
      signal: "SIGTERM",
      stdout: "",
      stderr: [
        "error: unexpected argument 'open' found",
        "Usage: coven memory [OPTIONS]",
      ].join("\n"),
    },
    expected: "failed",
  },
  {
    name: "timeout",
    result: {
      kind: "timeout",
      code: null,
      signal: null,
      stdout: "",
      stderr: "",
    },
    expected: "failed",
  },
  {
    name: "signal",
    result: {
      kind: "exit",
      code: null,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
    },
    expected: "failed",
  },
  {
    name: "runtime nonzero",
    result: {
      kind: "exit",
      code: 1,
      signal: null,
      stdout: "",
      stderr: "daemon unavailable",
    },
    expected: "failed",
  },
  {
    name: "clap nonzero without recognized missing output",
    result: {
      kind: "exit",
      code: 2,
      signal: null,
      stdout: "",
      stderr: "configuration could not be loaded",
    },
    expected: "failed",
  },
  {
    name: "spawn error",
    result: {
      kind: "spawn_error",
      code: null,
      signal: null,
      stdout: "",
      stderr: "",
    },
    expected: "failed",
  },
];

for (const { name, result, expected } of memoryOpenProbeCases) {
  assert.equal(
    helpers.classifyMemoryOpenProbe(result),
    expected,
    `classifies ${name}`,
  );
}

assert.equal(
  typeof helpers.parseStandaloneLaunchUrl,
  "function",
  "the smoke harness exposes the current tokenless launch contract",
);
assert.equal(
  helpers.parseStandaloneLaunchUrl(
    "ready\nCoven Memory: http://127.0.0.1:3737/\n",
  )?.href,
  "http://127.0.0.1:3737/",
);
assert.equal(
  helpers.parseStandaloneLaunchUrl(
    "Coven Memory: http://[::1]:65535/\n",
  )?.href,
  "http://[::1]:65535/",
);
assert.equal(helpers.parseStandaloneLaunchUrl("still starting\n"), null);
for (const rejected of [
  "https://127.0.0.1:3737/",
  "http://localhost:3737/",
  "http://127.0.0.1/",
  "http://127.0.0.1:0/",
  "http://127.0.0.1:65536/",
  "http://user@127.0.0.1:3737/",
  "http://127.0.0.1:3737/path",
  "http://127.0.0.1:3737/?query=1",
  "http://127.0.0.1:3737/#launch=obsolete",
]) {
  assert.throws(
    () =>
      helpers.parseStandaloneLaunchUrl(
        `Coven Memory: ${rejected}\n`,
      ),
    /invalid standalone launch URL/,
  );
}

console.log("canonical-memory-smoke-helpers.test.mjs OK");
