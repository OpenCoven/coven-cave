import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

test("retained privacy cleanup does not load the Research mission engine", async () => {
  const result = await build({
    entryPoints: ["src/lib/server/research-runtime-privacy.ts", "src/lib/server/x-sources.ts"],
    bundle: true,
    platform: "node",
    packages: "external",
    format: "esm",
    outdir: "unused-privacy-boundary-output",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  const inputs = Object.keys(result.metafile.inputs).map((file) => file.replaceAll("\\", "/"));
  assert.ok(inputs.includes("src/lib/server/research-workspace-files.ts"));
  assert.ok(inputs.includes("src/lib/server/research-runtime-contract.ts"));
  assert.deepEqual(inputs.filter((file) =>
    /\/research-(?:missions|mission-store|mission-x-runtime|resource-ingestion)\.ts$/.test(file)), [],
  "privacy cleanup must work without Research mission parsing, hydration, or ingestion");
});

test("cleanup never follows a linked runtime parent to unlink an outside entry", async () => {
  const { mkdtemp, mkdir, symlink, lstat, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { removeResearchMissionXRuntime } = await import("./research-runtime-privacy.ts");
  const root = await mkdtemp(path.join(tmpdir(), "cave-privacy-boundary-"));
  const previous = process.env.COVEN_RESEARCH_MISSIONS_DIR;
  try {
    const missions = path.join(root, "missions");
    const mission = path.join(missions, "privacy-case");
    const outside = path.join(root, "outside");
    const target = path.join(root, "target");
    await Promise.all([mkdir(mission, { recursive: true }), mkdir(outside), mkdir(target)]);
    const linkType = process.platform === "win32" ? "junction" : "dir";
    await symlink(outside, path.join(mission, "runtime"), linkType);
    await symlink(target, path.join(outside, "x"), linkType);
    process.env.COVEN_RESEARCH_MISSIONS_DIR = missions;
    await assert.rejects(removeResearchMissionXRuntime("privacy-case"), /runtime must be a real directory/);
    assert.equal((await lstat(path.join(outside, "x"))).isSymbolicLink(), true);
  } finally {
    if (previous === undefined) delete process.env.COVEN_RESEARCH_MISSIONS_DIR;
    else process.env.COVEN_RESEARCH_MISSIONS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
