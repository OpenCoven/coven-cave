import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  forbiddenStandaloneRoot,
  standaloneMetrics,
  STANDALONE_BUDGETS,
  STANDALONE_FORBIDDEN_ROOT_PREFIXES,
  STANDALONE_FORBIDDEN_ROOTS,
  verifyStandaloneArtifact,
} from "./standalone-budget.mjs";
import { SIDECAR_DYNAMIC_PACKAGES } from "./sidecar-runtime-closure.mjs";

assert.equal(STANDALONE_BUDGETS.fileCount, 12_000, "standalone output allows at most 12,000 files");

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
  assert.equal(forbiddenStandaloneRoot(".tmp/repo-snapshot/package.json"), ".tmp");
  // Synthetic sample name — not a real checkout path. Patrol fixtures now live
  // under tmpdir as worktree-lifecycle-fixture-* (no leading dot); this string
  // only exercises the forbiddenStandaloneRoot prefix match (cave-ad63l).
  assert.equal(
    forbiddenStandaloneRoot(".worktree-lifecycle-fixture-sample"),
    ".worktree-lifecycle-fixture-sample",
  );
  assert.equal(
    forbiddenStandaloneRoot(".worktree-lifecycle-fixture-sample/repo/README.md"),
    ".worktree-lifecycle-fixture-sample",
  );
  assert.equal(
    forbiddenStandaloneRoot("apps/ios/CovenCave/build/Release/CovenCave.app"),
    "apps/ios/CovenCave/build",
  );
  assert.equal(
    forbiddenStandaloneRoot("apps/ios/CovenCave/build-cody-cma81/Release/CovenCave.app"),
    "apps/ios/CovenCave/build-cody-cma81",
  );
  // `build*` still names only real Xcode output; the rest of apps/ is forbidden whole (#6086).
  assert.equal(forbiddenStandaloneRoot("apps/ios/CovenCave/building-notes/file.txt"), "apps");
  assert.equal(forbiddenStandaloneRoot("playwright.threads-live.config.ts"), "playwright.threads-live.config.ts");
  assert.equal(forbiddenStandaloneRoot("marketplace/plugins/x/plugin.json"), undefined);
  assert.equal(forbiddenStandaloneRoot("tsconfig.json"), "tsconfig.json", "a runtime join that matches the tsconfig by name fails the artifact check (#6093)");
  assert.equal(forbiddenStandaloneRoot("node_modules/target/index.js"), undefined);

  const nextConfig = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(
    nextConfig,
    /"\.\/\.worktree-lifecycle-fixture-\*\/\*\*\/\*"/,
    "Next tracing excludes every generated lifecycle fixture root",
  );
  assert.match(
    nextConfig,
    /"\.\/\.tmp\/\*\*\/\*"/,
    "Next tracing excludes checkout-local temporary artifacts",
  );
  assert.match(
    nextConfig,
    /"\.\/apps\/\*\*\/\*"/,
    "Next tracing excludes the native app trees, suffixed iOS build roots included",
  );
  // Turbopack resolves an include by reading every directory under its first
  // segment, for each matching route; one interrupted readdir panicked a local
  // build (#6093). The sidecar copies the packages the include used to force.
  assert.doesNotMatch(nextConfig, /^\s*outputFileTracingIncludes\s*:/m, "next.config.ts declares no tracing includes");
  for (const packageName of ["@swc/helpers", "node-pty"]) {
    assert.ok(
      SIDECAR_DYNAMIC_PACKAGES.includes(packageName),
      `the sidecar copies ${packageName} from the locked install`,
    );
  }
  // Every root the artifact guard forbids is also excluded from tracing, so a
  // forbidden root in the output means a new glob, not a missing exclude (#6086).
  const excludes = new Set([...nextConfig.matchAll(/"(\.\/[^"]+)"/g)].map((match) => match[1]));
  for (const root of STANDALONE_FORBIDDEN_ROOTS) {
    assert.ok(
      excludes.has(`./${root}/**/*`) || excludes.has(`./${root}`),
      `next.config.ts excludes the forbidden standalone root ${root}`,
    );
  }
  for (const prefix of STANDALONE_FORBIDDEN_ROOT_PREFIXES) {
    const stem = `./${prefix.replace(/[.-]$/, "")}`;
    assert.ok(
      [...excludes].some((exclude) => exclude.startsWith(stem)),
      `next.config.ts excludes the forbidden standalone prefix ${prefix}`,
    );
  }

  const leaked = path.join(fixture, "target-windows");
  await write(leaked, "debug/build.exe", "binary\n");
  await assert.rejects(verifyStandaloneArtifact(fixture), /forbidden root leaked.*target-windows/);
  await rm(leaked, { recursive: true, force: true });

  await write(fixture, "docs/superpowers/specs/design.md", "# spec\n");
  await assert.rejects(verifyStandaloneArtifact(fixture), /forbidden root leaked.*docs/);
  await rm(path.join(fixture, "docs"), { recursive: true, force: true });
  await write(fixture, "playwright.threads-live.config.ts", "export default {};\n");
  await assert.rejects(verifyStandaloneArtifact(fixture), /forbidden root leaked.*playwright\.threads-live\.config\.ts/);
  await rm(path.join(fixture, "playwright.threads-live.config.ts"), { force: true });

  const leakedIosBuild = path.join(fixture, "apps/ios/CovenCave/build-cody-cma81");
  await write(leakedIosBuild, "Release/CovenCave.app", "binary\n");
  await assert.rejects(
    verifyStandaloneArtifact(fixture),
    // The walk meets the forbidden `apps` directory before the build root inside it (#6086).
    /forbidden root leaked into Next standalone output: apps$/,
  );
  await rm(path.join(fixture, "apps"), { recursive: true, force: true });

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
