// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./library-graph-view.tsx", import.meta.url), "utf8");
const tauriSource = await readFile(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");

assert.match(
  source,
  /function pickGraphifyDirectory/,
  "Graphify modal should own a native directory picker helper",
);
assert.match(
  source,
  /invoke\("shell_pick_directory"\)/,
  "Graphify modal should ask Tauri to open a directory picker",
);
assert.match(
  source,
  /aria-label="Choose Graphify target folder"/,
  "Graphify modal should expose an accessible choose-folder action",
);
assert.match(
  source,
  /setTargetPath\(picked\.path\)/,
  "Choosing a folder should fill the target path input",
);
assert.match(
  tauriSource,
  /fn shell_pick_directory\(\) -> Result<Option<String>, String>/,
  "Tauri should expose a directory picker command",
);
assert.match(
  tauriSource,
  /shell_pick_directory,/,
  "Directory picker command should be registered with Tauri",
);
assert.match(
  source,
  /import \{ LibraryGraph3D \} from "@\/components\/library-graph-3d"/,
  "Library graph view should render the Three.js graph surface",
);
assert.match(
  source,
  /<LibraryGraph3D[\s\S]*snapshots=\{activeSnapshots\}/,
  "Library graph view should pass snapshot history into the 3D graph",
);
assert.match(
  source,
  /onRunStart=\{handleRunStart\}/,
  "Graphify modal should publish a live started snapshot while extraction runs",
);

console.log("library-graph-view.test.ts: ok");
