import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  assembleSidecarRuntime,
  collectTracedDependencies,
  SIDECAR_FORBIDDEN_ROOTS,
  SIDECAR_RUNTIME_BUDGETS,
  verifySidecarRuntime,
} from "./sidecar-runtime-closure.mjs";
import { publishSidecarArchive } from "./sidecar-archive-manifest.mjs";

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
  assert.ok(metrics.fileCount <= 5_450);
  assert.ok(metrics.unpackedBytes < 200 * 1024 * 1024);
  assert.deepEqual(SIDECAR_RUNTIME_BUDGETS, {
    fileCount: 5_450,
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
  await writeFile(publishedArchive, "previous archive\n");
  await writeFile(publishedManifest, "previous manifest\n");
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
  assert.equal(await readFile(publishedArchive, "utf8"), "previous archive\n");
  assert.equal(await readFile(publishedManifest, "utf8"), "previous manifest\n");
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
  assert.equal(createHash("sha256").update(publishedArchiveBytes).digest("hex"), published.archiveSha256);
  assert.deepEqual(JSON.parse(await readFile(publishedManifest, "utf8")), published);
  assert.ok(await missing(verifiedArchive), "successful publication must consume its staged archive");

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
