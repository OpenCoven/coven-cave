import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  forbiddenStandaloneRoot,
  standaloneMetrics,
  STANDALONE_FORBIDDEN_ROOTS,
  verifyStandaloneArtifact,
} from "./standalone-budget.mjs";

async function write(root, relativePath, contents = "fixture\n") {
  const output = path.join(root, relativePath);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, contents, "utf8");
}

const fixture = await mkdtemp(path.join(os.tmpdir(), "coven-standalone-budget-"));
try {
  await write(fixture, "server.js", "require('next');\n");
  await write(fixture, ".next/BUILD_ID", "fixture-build\n");

  const metrics = await standaloneMetrics(fixture);
  assert.equal(metrics.fileCount, 2);
  assert.equal(metrics.directoryCount, 1);
  assert.ok(metrics.unpackedBytes > 0);
  assert.deepEqual(await verifyStandaloneArtifact(fixture, { fileCount: 2, unpackedBytes: 1_024 }), metrics);

  await assert.rejects(
    verifyStandaloneArtifact(fixture, { fileCount: 1, unpackedBytes: 1_024 }),
    /fileCount 2 exceeds target 1/,
  );
  await assert.rejects(
    verifyStandaloneArtifact(fixture, { fileCount: 2, unpackedBytes: 1 }),
    /unpackedBytes .* exceeds target 1/,
  );

  for (const root of STANDALONE_FORBIDDEN_ROOTS) {
    assert.equal(forbiddenStandaloneRoot(root), root);
    assert.equal(forbiddenStandaloneRoot(`${root}/nested/file`), root);
  }
  assert.equal(forbiddenStandaloneRoot("node_modules/target/index.js"), undefined);

  const leaked = path.join(fixture, "target-windows");
  await write(leaked, "debug/build.exe", "binary\n");
  await assert.rejects(verifyStandaloneArtifact(fixture), /forbidden root leaked.*target-windows/);
  await rm(leaked, { recursive: true, force: true });

  try {
    await symlink("server.js", path.join(fixture, "server-link.js"));
    const linkedMetrics = await standaloneMetrics(fixture);
    assert.equal(linkedMetrics.fileCount, 3, "pnpm-style runtime links count as artifact entries");
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOSYS"].includes(error.code)) throw error;
    console.warn(`standalone-budget.test: symlink assertion skipped (${error.code})`);
  }
} finally {
  await rm(fixture, { recursive: true, force: true });
}

console.log("standalone-budget.test.mjs: ok");
