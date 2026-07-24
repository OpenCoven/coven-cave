import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  assembleSidecarRuntime,
  collectTracedDependencies,
  SIDECAR_FORBIDDEN_ROOTS,
  SIDECAR_RUNTIME_BUDGETS,
  verifySidecarRuntime,
} from "./sidecar-runtime-closure.mjs";
import { publishSidecarArchive, writeSidecarArchiveManifest } from "./sidecar-archive-manifest.mjs";

async function write(root, relativePath, contents = "fixture\n") {
  const output = path.join(root, relativePath);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, contents, "utf8");
}

async function packageFixture(root, packageName, extra = {}) {
  const packageRoot = path.join(root, "node_modules", ...packageName.split("/"));
  await write(packageRoot, "package.json", `${JSON.stringify({ name: packageName, version: "1.0.0" })}\n`);
  await write(packageRoot, "index.js", `module.exports = ${JSON.stringify(packageName)};\n`);
  for (const [relativePath, contents] of Object.entries(extra)) await write(packageRoot, relativePath, contents);
}

async function missing(target) {
  try {
    await access(target);
    return false;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}

const fixture = await mkdtemp(path.join(os.tmpdir(), "coven-sidecar-closure-"));
const projectRoot = path.join(fixture, "project");
const standaloneRoot = path.join(projectRoot, ".next", "standalone");
const dependencyRoot = path.join(fixture, "locked-production", "node_modules");
const destination = path.join(fixture, "output");

try {
  await write(projectRoot, "package.json", '{"name":"fixture","version":"9.8.7"}\n');
  await write(projectRoot, "server.mjs", "export {};\n");
  await write(projectRoot, "vault.yaml", "{}\n");
  await write(projectRoot, ".agents/skills/runtime/SKILL.md", "# Runtime skill\n");
  await write(projectRoot, "marketplace/catalog.json", "{}\n");
  await write(projectRoot, "marketplace/exports/mcp/mcp.json", "{}\n");
  await write(projectRoot, "marketplace/marketplace.json", "{}\n");
  await write(projectRoot, "marketplace/plugins/example/plugin.json", "{}\n");
  await write(projectRoot, "public/sandbox/react-runtime.js", "runtime\n");
  await write(projectRoot, "public/sandbox/tailwind.js", "tailwind\n");
  await write(projectRoot, "workflows/example.yaml", "id: example\n");
  for (const forbiddenRoot of SIDECAR_FORBIDDEN_ROOTS) {
    await write(projectRoot, `${forbiddenRoot}/must-not-ship.txt`, "development only\n");
  }

  await write(projectRoot, ".next/static/chunk.js", "chunk\n");
  await write(standaloneRoot, ".next/BUILD_ID", "fixture-build\n");
  await write(standaloneRoot, ".next/required-server-files.json", "{}\n");
  await write(standaloneRoot, ".next/server/route.js", "route\n");
  await write(standaloneRoot, ".next/server/route.js.map", "build-only map\n");
  await write(standaloneRoot, "server.js", "require('next');\n");

  for (const packageName of [
    "@next/env",
    "@swc/helpers",
    "@img/sharp-win32-x64",
    "foo",
    "next",
    "node-pty",
    "react",
    "react-dom",
    "sharp",
    "ws",
  ]) {
    await packageFixture(projectRoot, packageName);
    await packageFixture(path.dirname(dependencyRoot), packageName);
  }
  await write(projectRoot, "node_modules/@img/sharp-win32-x64/lib/libvips-42.dll", "native dependency\n");
  await write(dependencyRoot, "@img/sharp-win32-x64/lib/libvips-42.dll", "native dependency\n");
  await write(projectRoot, "node_modules/foo/node_modules/evil/index.js", "must not be copied\n");

  const tracePath = path.join(projectRoot, ".next", "server", "route.js.nft.json");
  const traceEntries = ["foo", "next", "react", "react-dom"].map(
    (packageName) => `../../node_modules/${packageName}/index.js`,
  );
  traceEntries.push("../../src/development-only.ts");
  await write(projectRoot, ".next/server/route.js.nft.json", `${JSON.stringify({ version: 1, files: traceEntries })}\n`);

  const trace = await collectTracedDependencies(projectRoot);
  assert.equal(trace.traceFileCount, 1);
  assert.deepEqual(trace.packageNames, ["foo", "next", "react", "react-dom"]);

  await assembleSidecarRuntime(projectRoot, standaloneRoot, dependencyRoot, destination);
  const metrics = await verifySidecarRuntime(destination);
  assert.ok(metrics.fileCount <= 5_693);
  assert.ok(metrics.unpackedBytes < 200 * 1024 * 1024);
  assert.deepEqual(SIDECAR_RUNTIME_BUDGETS, {
    fileCount: 5_693,
    unpackedBytes: 200 * 1024 * 1024 - 1,
  });

  assert.equal(JSON.parse(await readFile(path.join(destination, "package.json"), "utf8")).version, "9.8.7");
  assert.equal(await readFile(path.join(destination, "marketplace/catalog.json"), "utf8"), "{}\n");
  assert.equal(await readFile(path.join(destination, "marketplace/plugins/example/plugin.json"), "utf8"), "{}\n");
  assert.equal(await readFile(path.join(destination, "workflows/example.yaml"), "utf8"), "id: example\n");
  assert.equal(await readFile(path.join(destination, "public/sandbox/tailwind.js"), "utf8"), "tailwind\n");
  assert.equal(await readFile(path.join(destination, "node_modules/foo/index.js"), "utf8"), 'module.exports = "foo";\n');
  assert.equal(
    await readFile(path.join(destination, "node_modules/@img/sharp-win32-x64/lib/libvips-42.dll"), "utf8"),
    "native dependency\n",
  );
  assert.ok(await missing(path.join(destination, "node_modules/foo/node_modules/evil/index.js")));
  assert.ok(await missing(path.join(destination, ".next/server/route.js.map")));
  for (const forbiddenRoot of SIDECAR_FORBIDDEN_ROOTS) {
    assert.ok(await missing(path.join(destination, forbiddenRoot)), `${forbiddenRoot} must be excluded`);
  }

  const optionalPackage = "@next/swc-linux-x64-gnu";
  await packageFixture(projectRoot, optionalPackage);
  await writeFile(
    tracePath,
    `${JSON.stringify({
      version: 1,
      files: [...traceEntries, `../../node_modules/${optionalPackage}/index.js`],
    })}\n`,
    "utf8",
  );
  await assembleSidecarRuntime(projectRoot, standaloneRoot, dependencyRoot, destination);
  assert.ok(
    await missing(path.join(destination, "node_modules", ...optionalPackage.split("/"))),
    "a traced platform-optional package absent from this target's locked install may be skipped",
  );

  await writeFile(tracePath, `${JSON.stringify({ version: 1, files: traceEntries })}\n`, "utf8");
  for (const requiredPackage of ["sharp", "node-pty", "ws"]) {
    const requiredRoot = path.join(dependencyRoot, requiredPackage);
    await rm(requiredRoot, { recursive: true, force: true });
    await assert.rejects(
      assembleSidecarRuntime(projectRoot, standaloneRoot, dependencyRoot, destination),
      new RegExp(`required dynamic sidecar package is missing: ${requiredPackage}`),
      `missing required dynamic package ${requiredPackage} must fail closed`,
    );
    await packageFixture(path.dirname(dependencyRoot), requiredPackage);
  }

  const externalPackageRoot = path.join(fixture, "outside-allowed-roots", "sharp");
  await write(externalPackageRoot, "package.json", '{"name":"sharp","version":"1.0.0"}\n');
  await write(externalPackageRoot, "index.js", "module.exports = 'outside';\n");
  await rm(path.join(dependencyRoot, "sharp"), { recursive: true, force: true });
  try {
    await symlink(
      externalPackageRoot,
      path.join(dependencyRoot, "sharp"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      assembleSidecarRuntime(projectRoot, standaloneRoot, dependencyRoot, destination),
      /sidecar dependency link escapes its allowed roots/,
      "dependency links must not escape the locked production root",
    );
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOSYS"].includes(error.code)) throw error;
    console.warn(`sidecar-runtime-closure.test: symlink confinement skipped (${error.code})`);
  } finally {
    await rm(path.join(dependencyRoot, "sharp"), { recursive: true, force: true });
    await packageFixture(path.dirname(dependencyRoot), "sharp");
  }

  const publishedArchive = path.join(fixture, "published", "server.tar.zst");
  const publishedManifest = path.join(fixture, "published", "manifest.json");
  const interruptedArchive = path.join(fixture, "published", ".server.tar.zst.interrupted.tmp");
  await mkdir(path.dirname(publishedArchive), { recursive: true });
  await writeFile(interruptedArchive, "candidate archive\n");
  await assert.rejects(
    publishSidecarArchive(
      path.join(fixture, "missing-runtime"),
      interruptedArchive,
      publishedArchive,
      publishedManifest,
    ),
    /ENOENT/,
    "failed verification must interrupt publication",
  );
  assert.ok(await missing(publishedArchive), "failed first publication must not leave a public archive");
  assert.ok(await missing(publishedManifest), "failed first publication must not leave a public manifest");
  assert.ok(await missing(interruptedArchive), "failed publication must remove its staged archive");

  const verifiedArchive = path.join(fixture, "published", ".server.tar.zst.verified.tmp");
  await writeFile(verifiedArchive, "verified candidate archive\n");
  const published = await publishSidecarArchive(
    path.join(projectRoot, "public"),
    verifiedArchive,
    publishedArchive,
    publishedManifest,
  );
  const publishedArchiveBytes = await readFile(publishedArchive);
  const publishedManifestBytes = await readFile(publishedManifest);
  assert.equal(createHash("sha256").update(publishedArchiveBytes).digest("hex"), published.archiveSha256);
  assert.deepEqual(JSON.parse(await readFile(publishedManifest, "utf8")), published);
  assert.ok(await missing(verifiedArchive), "successful publication must consume its staged archive");
  assert.ok(await missing(`${publishedArchive}.previous`), "successful publication must remove its archive backup");
  assert.ok(await missing(`${publishedManifest}.previous`), "successful publication must remove its manifest backup");

  await write(projectRoot, "public/sandbox/tailwind.js", "changed runtime\n");
  const candidateArchive = path.join(fixture, "published", ".server.tar.zst.candidate.tmp");
  const candidateManifest = path.join(fixture, "published", ".manifest.json.candidate.tmp");
  await writeSidecarArchiveManifest(path.join(projectRoot, "public"), candidateArchive, candidateManifest);
  const candidateArchiveBytes = await readFile(candidateArchive);
  const candidateManifestBytes = await readFile(candidateManifest);
  assert.notDeepEqual(candidateArchiveBytes, publishedArchiveBytes, "rollback candidate must differ from the prior archive");

  const failedManifestArchive = path.join(fixture, "published", ".server.tar.zst.failed-manifest.tmp");
  const failedManifestTemp = path.join(fixture, "published", ".manifest.json.failed-manifest.tmp");
  const failedManifestSentinel = path.join(publishedManifest, "unrelated.txt");
  await assert.rejects(
    publishSidecarArchive(
      path.join(projectRoot, "public"),
      failedManifestArchive,
      publishedArchive,
      publishedManifest,
      failedManifestTemp,
      {
        beforeManifestPublish: async () => {
          await rm(publishedManifest);
          await mkdir(publishedManifest);
          await writeFile(failedManifestSentinel, "must survive rollback\n");
        },
      },
    ),
    /EISDIR|EPERM|ENOTDIR|EACCES/,
    "final manifest publication failure must reject",
  );
  assert.deepEqual(
    await readFile(publishedArchive),
    publishedArchiveBytes,
    "final failure must restore the prior archive before manifest recovery is pending",
  );
  assert.equal(await readFile(failedManifestSentinel, "utf8"), "must survive rollback\n");
  assert.ok(await missing(failedManifestArchive), "final failure must remove its staged archive");
  assert.ok(await missing(failedManifestTemp), "final failure must remove its staged manifest");
  assert.ok(await missing(`${publishedArchive}.previous`), "final failure must consume its restored archive backup");
  assert.equal(await missing(`${publishedManifest}.previous`), false, "final failure must retain its manifest backup");

  await rm(publishedManifest, { recursive: true });
  const rollbackArchive = path.join(fixture, "published", ".server.tar.zst.rollback.tmp");
  await assert.rejects(
    publishSidecarArchive(
      path.join(fixture, "missing-runtime"),
      rollbackArchive,
      publishedArchive,
      publishedManifest,
    ),
    /ENOENT/,
    "the next publication must recover the preserved prior pair",
  );
  assert.deepEqual(await readFile(publishedArchive), publishedArchiveBytes, "recovery must restore the prior public archive");
  assert.deepEqual(await readFile(publishedManifest), publishedManifestBytes, "recovery must restore the prior manifest");
  assert.ok(await missing(rollbackArchive), "recovery failure must remove its staged archive");
  assert.ok(await missing(`${publishedArchive}.previous`), "recovery must consume the prior archive backup");
  assert.ok(await missing(`${publishedManifest}.previous`), "recovery must consume the prior manifest backup");

  const previousArchive = `${publishedArchive}.previous`;
  const previousManifest = `${publishedManifest}.previous`;
  await rename(publishedArchive, previousArchive);
  await writeFile(publishedArchive, candidateArchiveBytes);
  await writeFile(previousManifest, publishedManifestBytes);
  await rm(candidateArchive);
  await rm(candidateManifest);

  const interruptedRollbackArchive = path.join(fixture, "published", ".server.tar.zst.interrupted-rollback.tmp");
  await assert.rejects(
    publishSidecarArchive(
      path.join(fixture, "missing-runtime"),
      interruptedRollbackArchive,
      publishedArchive,
      publishedManifest,
    ),
    /ENOENT/,
    "recovery must preserve the original publication when the next build fails",
  );
  assert.deepEqual(
    await readFile(publishedArchive),
    publishedArchiveBytes,
    "recovery must restore the prior public archive",
  );
  assert.deepEqual(await readFile(publishedManifest), publishedManifestBytes, "recovery must restore the prior manifest");
  assert.ok(await missing(interruptedRollbackArchive), "failed publication must remove its staged archive");
  assert.ok(await missing(previousArchive), "recovery must consume the prior archive backup");
  assert.ok(await missing(previousManifest), "recovery must consume the prior manifest backup");

  await writeFile(previousManifest, publishedManifestBytes);
  await writeFile(publishedManifest, candidateManifestBytes);
  const partialRestoreArchive = path.join(fixture, "published", ".server.tar.zst.partial-restore.tmp");
  await assert.rejects(
    publishSidecarArchive(
      path.join(fixture, "missing-runtime"),
      partialRestoreArchive,
      publishedArchive,
      publishedManifest,
    ),
    /ENOENT/,
    "recovery must resume after restoring an archive before its manifest",
  );
  assert.deepEqual(await readFile(publishedArchive), publishedArchiveBytes, "partial recovery must retain the restored archive");
  assert.deepEqual(await readFile(publishedManifest), publishedManifestBytes, "partial recovery must restore its manifest");
  assert.ok(await missing(previousManifest), "partial recovery must consume the prior manifest backup");

  const noPriorArchive = path.join(fixture, "no-prior", "server.tar.zst");
  const noPriorManifest = path.join(fixture, "no-prior", "manifest.json");
  const noPriorTemporaryArchive = path.join(fixture, "no-prior", ".server.tar.zst.tmp");
  const noPriorTemporaryManifest = path.join(fixture, "no-prior", ".manifest.json.tmp");
  await mkdir(path.dirname(noPriorArchive), { recursive: true });
  await writeFile(`${noPriorArchive}.publish.lock`, "999999999\n");
  await assert.rejects(
    publishSidecarArchive(
      path.join(projectRoot, "public"),
      noPriorTemporaryArchive,
      noPriorArchive,
      noPriorManifest,
      noPriorTemporaryManifest,
      {
        beforeManifestPublish: async () => {
          await mkdir(noPriorManifest, { recursive: true });
          await writeFile(path.join(noPriorManifest, "unrelated.txt"), "must survive first publish failure\n");
        },
      },
    ),
    /EISDIR|EPERM|ENOTDIR|EACCES/,
    "a no-prior publication failure must reject",
  );
  assert.ok(await missing(noPriorArchive), "a no-prior failure must not leave a public archive");
  assert.ok(await missing(noPriorTemporaryArchive), "a no-prior failure must remove its staged archive");
  assert.ok(await missing(noPriorTemporaryManifest), "a no-prior failure must remove its staged manifest");
  assert.equal(
    await readFile(path.join(noPriorManifest, "unrelated.txt"), "utf8"),
    "must survive first publish failure\n",
  );
  assert.ok(await missing(`${noPriorArchive}.publish.lock`), "a stale publication lock must be reclaimed");

  const orphanArchive = path.join(fixture, "orphan", "server.tar.zst");
  const orphanManifest = path.join(fixture, "orphan", "manifest.json");
  const orphanTemporaryArchive = path.join(fixture, "orphan", ".server.tar.zst.tmp");
  const orphanTemporaryManifest = path.join(fixture, "orphan", ".manifest.json.tmp");
  await mkdir(path.dirname(orphanArchive), { recursive: true });
  await writeFile(orphanManifest, "stale manifest\n");
  await assert.rejects(
    publishSidecarArchive(
      path.join(projectRoot, "public"),
      orphanTemporaryArchive,
      orphanArchive,
      orphanManifest,
      orphanTemporaryManifest,
      {
        beforeManifestPublish: async () => {
          const error = new Error("EPERM: injected final manifest rename failure");
          error.code = "EPERM";
          throw error;
        },
      },
    ),
    /EPERM/,
    "an orphaned manifest publication failure must reject",
  );
  assert.ok(await missing(orphanArchive), "an orphaned manifest must not retain the candidate archive");
  assert.equal(await readFile(orphanManifest, "utf8"), "stale manifest\n");
  assert.ok(await missing(`${orphanManifest}.previous`), "orphan recovery must remove its private manifest copy");
  assert.ok(await missing(orphanTemporaryArchive), "orphan recovery must remove its staged archive");
  assert.ok(await missing(orphanTemporaryManifest), "orphan recovery must remove its staged manifest");

  await writeFile(tracePath, `${JSON.stringify({ version: 1, files: ["../../../outside.txt"] })}\n`, "utf8");
  await assert.rejects(
    collectTracedDependencies(projectRoot),
    /Next trace escapes the project root/,
    "trace input must not copy arbitrary files from outside the project",
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
}

console.log("sidecar-runtime-closure.test.mjs: ok");
