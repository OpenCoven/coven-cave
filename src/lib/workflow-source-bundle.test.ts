import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Regression: the packaged desktop sidecar runs with its cwd inside the
// read-only, code-signed .app bundle. Public workflow writes (manifest .yaml +
// canvas-layout .cave.json) must NOT land in the bundle — that breaks the
// signature seal and the in-place auto-updater. In bundle mode they go to a
// writable per-user dir, seeded once from the bundle's shipped templates.

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

const origCwd = process.cwd();
const bundle = await mkdtemp(path.join(tmpdir(), "cave-wf-bundle-"));
const home = await mkdtemp(path.join(tmpdir(), "cave-wf-home-"));

// The "bundle" ships seed workflows alongside the server (cwd/workflows).
const seedDir = path.join(bundle, "workflows");
await mkdir(seedDir, { recursive: true });
await writeFile(
  path.join(seedDir, "demo.yaml"),
  "id: demo\nversion: 1.0.0\nname: Demo\npattern: sequential\nsteps:\n  - id: a\n    kind: agent\n",
);
await writeFile(
  path.join(seedDir, "demo.cave.json"),
  JSON.stringify({ version: 1, positions: { a: { x: 1, y: 2 } } }),
);

process.chdir(bundle);
process.env.COVEN_CAVE_BUNDLE = "1";
process.env.COVEN_HOME = home;
delete process.env.COVEN_WORKFLOWS_DIR;
delete process.env.COVEN_PERSONAL_WORKFLOWS_DIR;

const { workflowsDir, loadLocalWorkflowList, saveWorkflowLayout } = await import("./workflow-source.ts");

// 1. Bundle mode resolves the public dir to the writable covenHome, not cwd.
const writableDir = workflowsDir();
assert.equal(writableDir, path.join(home, "cave", "workflows"));
assert.notEqual(path.resolve(writableDir), path.resolve(seedDir));

// 2. Reading the list seeds the writable dir from the bundle's templates.
const seedBefore = (await readdir(seedDir)).sort();
const list = await loadLocalWorkflowList();
assert.ok(
  list.workflows.some((w) => w.id === "demo"),
  "seeded demo workflow appears in the list",
);
const seeded = (await readdir(writableDir)).sort();
assert.deepEqual(seeded, ["demo.cave.json", "demo.yaml"], "seed files copied to writable dir");

// 3. The bundle's workflows dir is never mutated.
assert.deepEqual((await readdir(seedDir)).sort(), seedBefore, "bundle workflows dir untouched by read");

// 4. Saving a public layout writes to the writable dir, never the bundle.
const saved = await saveWorkflowLayout("demo", { a: { x: 5, y: 6 } });
assert.ok(saved.ok, "layout save succeeds");
assert.deepEqual((await readdir(seedDir)).sort(), seedBefore, "layout save did not write into the bundle");
const layoutRaw = await readFile(path.join(writableDir, "demo.cave.json"), "utf8");
assert.match(layoutRaw, /"x":\s*5/, "layout persisted to the writable dir");

// cleanup
process.chdir(origCwd);
await rm(bundle, { recursive: true, force: true });
await rm(home, { recursive: true, force: true });
assert.ok(!(await exists(bundle)), "temp bundle removed");

console.log("ok - workflow-source bundle mode seeds writable dir and never writes the bundle");
