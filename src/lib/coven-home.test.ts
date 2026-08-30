// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { covenHomePath } from "./coven-home.ts";

const localHome = "C:/Users/Sonic";
const remoteHome = String.raw`\\evil-host\share\.coven`;

assert.equal(
  covenHomePath({ COVEN_HOME: remoteHome }, localHome, "win32"),
  path.join(localHome, ".coven"),
  "a remote COVEN_HOME must fall back to the local home",
);
assert.equal(
  covenHomePath({ COVEN_HOME: "D:/coven-home" }, localHome, "win32"),
  "D:/coven-home",
  "a local Windows COVEN_HOME remains honored",
);
assert.equal(
  covenHomePath({ COVEN_HOME: "/opt/coven-home" }, "/home/cave", "linux"),
  "/opt/coven-home",
  "a Unix COVEN_HOME remains honored",
);

let refused: string | undefined;
assert.equal(
  covenHomePath(
    { COVEN_HOME: remoteHome },
    localHome,
    "win32",
    (configured) => { refused = configured; },
  ),
  path.join(localHome, ".coven"),
);
assert.equal(refused, remoteHome, "the daemon can retain refusal diagnostics");

assert.equal(
  covenHomePath(
    { COVEN_HOME: remoteHome },
    localHome,
    "win32",
    () => { throw new Error("diagnostics unavailable"); },
  ),
  path.join(localHome, ".coven"),
  "diagnostic failure must not weaken the local fallback",
);

const consumers = [
  "src/lib/coven-paths.ts",
  "src/lib/coven-bin.ts",
  "src/lib/server/adapter-conflict-heal.ts",
  "src/lib/server/craft-drafts.ts",
  "src/lib/openclaw-compatibility.ts",
  "src/lib/opencode-compatibility.ts",
  "src/lib/grok-compatibility.ts",
];

for (const consumer of consumers) {
  const source = await readFile(consumer, "utf8");
  assert.match(source, /coven-home\.ts/, `${consumer} must import the shared resolver`);
  assert.match(source, /\bcovenHomePath\(/, `${consumer} must call the shared resolver`);
  assert.doesNotMatch(
    source,
    /process\.env\.COVEN_HOME\s*\|\|/,
    `${consumer} must not restore an unchecked COVEN_HOME fallback`,
  );
}

console.log("coven-home.test.ts: ok");
