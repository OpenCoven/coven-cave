// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const originalEnv = {
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_WORKSPACES_ROOT: process.env.COVEN_WORKSPACES_ROOT,
  COVEN_WORKSPACE_ROOT: process.env.COVEN_WORKSPACE_ROOT,
  WORKSPACE_ROOT: process.env.WORKSPACE_ROOT,
  NEXT_PUBLIC_WORKSPACE_ROOT: process.env.NEXT_PUBLIC_WORKSPACE_ROOT,
  OPENCLAW_WORKSPACE_ROOT: process.env.OPENCLAW_WORKSPACE_ROOT,
  CAVE_PROJECTS_PATH_OVERRIDE: process.env.CAVE_PROJECTS_PATH_OVERRIDE,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

const tmp = await mkdtemp(path.join(tmpdir(), "coven-project-paths-"));

try {
  process.env.COVEN_HOME = path.join(tmp, ".coven");
  process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(tmp, "cave-projects.json");
  delete process.env.COVEN_WORKSPACES_ROOT;
  delete process.env.COVEN_WORKSPACE_ROOT;
  delete process.env.WORKSPACE_ROOT;
  delete process.env.NEXT_PUBLIC_WORKSPACE_ROOT;
  delete process.env.OPENCLAW_WORKSPACE_ROOT;

  const canonical = path.join(process.env.COVEN_HOME, "workspaces", "familiars", "sage");
  const savedProjectRoot = path.join(tmp, "Documents", "GitHub", "OpenCoven", "coven-docs");
  await mkdir(canonical, { recursive: true });
  await mkdir(path.join(savedProjectRoot, "docs"), { recursive: true });
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE,
    JSON.stringify({
      version: 1,
      projects: [{ id: "docs", name: "Coven Docs", root: savedProjectRoot }],
    }),
  );

  const { resolveAllowedProjectPath } = await import("./project-paths.ts");
  const legacy = path.join(process.env.COVEN_HOME, "workspace", "familiars", "sage");

  assert.equal(
    resolveAllowedProjectPath(legacy),
    await realpath(canonical),
    "legacy ~/.coven/workspace familiar paths normalize to canonical ~/.coven/workspaces paths",
  );

  assert.equal(
    resolveAllowedProjectPath(path.join(savedProjectRoot, "docs")),
    await realpath(path.join(savedProjectRoot, "docs")),
    "saved Cave project roots are allowed for file tree browsing",
  );
} finally {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
}

console.log("project-paths.test.ts: ok");
