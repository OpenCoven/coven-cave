import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let supervisor;
try {
  supervisor = await import("./dev-server-supervisor.mjs");
} catch {
  supervisor = null;
}

assert.ok(supervisor, "the development server supervisor module exists");
assert.equal(
  supervisor.shouldRestartDevServer({ code: 75, signal: null, stopping: false }),
  true,
  "the reserved recycle exit restarts a supervised development server",
);
assert.equal(
  supervisor.shouldRestartDevServer({ code: 1, signal: null, stopping: false }),
  false,
  "ordinary server failures remain visible instead of entering a restart loop",
);
assert.equal(
  supervisor.shouldRestartDevServer({ code: 75, signal: null, stopping: true }),
  false,
  "operator shutdown never restarts the server",
);

const inherited = supervisor.devServerEnvironment({
  NODE_OPTIONS: "--trace-warnings --max-old-space-size=2048",
});
assert.equal(inherited.NODE_ENV, "development");
assert.equal(inherited.COVEN_CAVE_DEV_SUPERVISED, "1");
assert.equal(
  inherited.NODE_OPTIONS,
  "--trace-warnings --max-old-space-size=2048",
  "an existing explicit heap ceiling is not duplicated",
);

const defaults = supervisor.devServerEnvironment({});
assert.match(defaults.NODE_OPTIONS, /--max-old-space-size=4096/);

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
assert.equal(
  packageJson.scripts.dev,
  "node scripts/dev-server-supervisor.mjs",
  "pnpm dev runs through the restart supervisor",
);

console.log("dev-server-supervisor.test.mjs: ok");
