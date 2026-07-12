import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_COMPONENT_ROWS,
  MAX_RUNTIME_ARCHIVE_BYTES,
  MAX_RUNTIME_FILES,
  MAX_RUNTIME_UNPACKED_BYTES,
  evaluateInstallerMetrics,
} from "./windows-installer-budget.mjs";

const healthy = {
  msiBytes: 50_000_000,
  fileRows: 80,
  componentRows: 82,
  directoryRows: 24,
  createFolderRows: 3,
  administrativeFiles: 90,
  administrativeBytes: 180_000_000,
  expandedServerFiles: 0,
  runtimeArchive: {
    archiveBytes: 30_000_000,
    unpackedBytes: 220_000_000,
    fileCount: 4_000,
  },
};

function changed(path, value) {
  const copy = structuredClone(healthy);
  if (path.length === 1) copy[path[0]] = value;
  else copy[path[0]][path[1]] = value;
  return copy;
}

test("accepts a bounded archive-backed installer", () => {
  assert.deepEqual(evaluateInstallerMetrics(healthy), { ok: true, errors: [] });
});

for (const [name, metrics, fragment] of [
  ["component rows", changed(["componentRows"], MAX_COMPONENT_ROWS + 1), "componentRows"],
  ["expanded server", changed(["expandedServerFiles"], 1), "expandedServerFiles"],
  ["archive bytes", changed(["runtimeArchive", "archiveBytes"], MAX_RUNTIME_ARCHIVE_BYTES + 1), "archiveBytes"],
  ["runtime bytes", changed(["runtimeArchive", "unpackedBytes"], MAX_RUNTIME_UNPACKED_BYTES + 1), "unpackedBytes"],
  ["runtime files", changed(["runtimeArchive", "fileCount"], MAX_RUNTIME_FILES + 1), "fileCount"],
]) {
  test(`rejects ${name} over budget`, () => {
    const result = evaluateInstallerMetrics(metrics);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes(fragment)), result.errors.join("\n"));
  });
}

test("rejects missing, negative, and non-numeric measurements", () => {
  const missing = structuredClone(healthy);
  delete missing.directoryRows;
  assert.equal(evaluateInstallerMetrics(missing).ok, false);
  assert.equal(evaluateInstallerMetrics(changed(["msiBytes"], -1)).ok, false);
  assert.equal(evaluateInstallerMetrics(changed(["fileRows"], "80")).ok, false);
});
