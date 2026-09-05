// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  caveHome,
  covenWorkspaceRoot,
  covenWorkspacesRoot,
  familiarIds,
  familiarWorkspace,
  familiarWorkspacesRoot,
  parseFamiliarWorkspaces,
  readFamiliarWorkspaces,
  readFamiliarWorkspacesStrict,
} from "./coven-paths.ts";

const originalEnv = {
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_CAVE_HOME: process.env.COVEN_CAVE_HOME,
  COVEN_WORKSPACES_ROOT: process.env.COVEN_WORKSPACES_ROOT,
  COVEN_WORKSPACE_ROOT: process.env.COVEN_WORKSPACE_ROOT,
  WORKSPACE_ROOT: process.env.WORKSPACE_ROOT,
  NEXT_PUBLIC_WORKSPACE_ROOT: process.env.NEXT_PUBLIC_WORKSPACE_ROOT,
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

const workspaces = parseFamiliarWorkspaces(`
[[familiar]]
id = "researcher"
workspace = "~/coven/researcher"

[[familiar]]
id = 'builder'
workspace = '/tmp/coven-builder' # trailing comment

[[familiar]]
id = "observer"
`);

assert.equal(workspaces.get("researcher"), path.join(homedir(), "coven", "researcher"));
assert.equal(workspaces.get("builder"), path.resolve("/tmp/coven-builder"));
assert.equal(workspaces.has("observer"), false);

try {
  process.env.COVEN_HOME = "/tmp/coven-home";
  delete process.env.COVEN_CAVE_HOME;
  delete process.env.COVEN_WORKSPACES_ROOT;
  delete process.env.COVEN_WORKSPACE_ROOT;
  delete process.env.WORKSPACE_ROOT;
  delete process.env.NEXT_PUBLIC_WORKSPACE_ROOT;

  assert.equal(caveHome(), path.join("/tmp/coven-home", "cave"), "caveHome defaults to <covenHome>/cave");
  process.env.COVEN_CAVE_HOME = "/tmp/custom-cave";
  assert.equal(caveHome(), "/tmp/custom-cave", "COVEN_CAVE_HOME overrides caveHome");
  delete process.env.COVEN_CAVE_HOME;

  assert.equal(covenWorkspacesRoot(), path.join("/tmp/coven-home", "workspaces"));
  assert.equal(covenWorkspaceRoot(), path.join("/tmp/coven-home", "workspaces"));
  assert.equal(familiarWorkspacesRoot(), path.join("/tmp/coven-home", "workspaces", "familiars"));
  assert.equal(await familiarWorkspace("orchestrator"), path.join("/tmp/coven-home", "workspaces", "familiars", "orchestrator"));
  assert.deepEqual(await familiarIds(), [], "familiarIds only returns declared familiars");

  process.env.COVEN_WORKSPACES_ROOT = "/tmp/coven-workspaces";
  assert.equal(covenWorkspacesRoot(), "/tmp/coven-workspaces");
  assert.equal(covenWorkspaceRoot(), "/tmp/coven-workspaces");
  assert.equal(await familiarWorkspace("helper"), path.join("/tmp/coven-workspaces", "familiars", "helper"));

  process.env.COVEN_WORKSPACE_ROOT = "/tmp/explicit-workspace-root";
  assert.equal(covenWorkspaceRoot(), "/tmp/explicit-workspace-root");
} finally {
  restoreEnv();
}

const daemonStatus = await readFile("src/app/api/daemon/status/route.ts", "utf8");
assert.match(daemonStatus, /covenWorkspaceRoot/);
assert.doesNotMatch(daemonStatus, /\.openclaw/);

const projectPaths = await readFile("src/lib/server/project-paths.ts", "utf8");
assert.match(projectPaths, /covenWorkspaceRoot/);
// project-paths.ts intentionally retains ~/.openclaw/workspace as an allowed
// root so Library can read pre-Coven research dirs. The original migration
// invariant ("no openclaw paths") was relaxed for this single case.

const localSkills = await readFile("src/app/api/skills/local/route.ts", "utf8");
assert.ok(localSkills.includes('path.join(covenHome(), "skills")'));
assert.doesNotMatch(localSkills, /familiarWorkspace|familiarIds/);
assert.doesNotMatch(localSkills, /\.openclaw/);

const directorySkills = await readFile("src/lib/server/skills-directory.ts", "utf8");
assert.ok(directorySkills.includes('path.join(covenHome(), "skills")'));
assert.doesNotMatch(directorySkills, /path\.join\(process\.cwd\(\), "\.coven"\)/);

const roles = await readFile("src/app/api/roles/route.ts", "utf8");
assert.doesNotMatch(roles, /\.openclaw/);

const roleSource = await readFile("src/lib/role-source.ts", "utf8");
assert.match(roleSource, /familiarWorkspace/);
assert.ok(roleSource.includes('path.join(covenHome(), "roles")'));
assert.doesNotMatch(roleSource, /\.openclaw/);

const chatSend = await readFile("src/app/api/chat/send/route.ts", "utf8");
const chatSendRuntime = await readFile("src/app/api/chat/send/chat-send-runtime.ts", "utf8");
assert.match(chatSend, /resolveFamiliarWorkspace/);
assert.match(chatSendRuntime, /Resolve a familiar workspace/);
assert.doesNotMatch(chatSend, /\.openclaw\/workspace/);

const covenPathsSource = await readFile("src/lib/coven-paths.ts", "utf8");
assert.match(
  covenPathsSource,
  /if \(\(error as NodeJS\.ErrnoException \| undefined\)\?\.code === "ENOENT"\) return new Map\(\);/,
  "strict familiar-workspace reads treat only a missing familiars.toml as empty",
);

const strictScratch = path.join(process.cwd(), `.coven-paths-strict-${process.pid}`);
try {
  process.env.COVEN_HOME = path.join(strictScratch, "home");
  delete process.env.COVEN_CAVE_HOME;
  delete process.env.COVEN_WORKSPACES_ROOT;
  delete process.env.COVEN_WORKSPACE_ROOT;
  delete process.env.WORKSPACE_ROOT;
  delete process.env.NEXT_PUBLIC_WORKSPACE_ROOT;

  assert.deepEqual(
    Array.from((await readFamiliarWorkspacesStrict()).entries()),
    [],
    "missing familiars.toml legitimately means no declared relocated workspaces",
  );

  await mkdir(path.join(process.env.COVEN_HOME, "familiars.toml"), { recursive: true });

  await assert.rejects(
    () => readFamiliarWorkspacesStrict(),
    /EISDIR/,
    "non-ENOENT familiar-workspace read failures propagate from the strict path",
  );
  assert.deepEqual(
    Array.from((await readFamiliarWorkspaces()).entries()),
    [],
    "the forgiving familiar-workspace reader stays compatible for existing callers",
  );

  await rm(path.join(process.env.COVEN_HOME, "familiars.toml"), { recursive: true, force: true });

  for (const malformed of [
    {
      name: "unterminated quoted workspace",
      raw: `[[familiar]]
id = "nova"
workspace = "/Users/example/nova
`,
      error: /unterminated/i,
    },
    {
      name: "invalid assignment syntax",
      raw: `[[familiar]]
id = "nova"
workspace: "/Users/example/nova"
`,
      error: /invalid assignment/i,
    },
    {
      name: "workspace assignment whose familiar id cannot be parsed",
      raw: `[[familiar]]
id = "nova
workspace = "/Users/example/nova"
`,
      error: /id/i,
    },
  ]) {
    await writeFile(path.join(process.env.COVEN_HOME, "familiars.toml"), malformed.raw);
    await assert.rejects(
      () => readFamiliarWorkspacesStrict(),
      malformed.error,
      `strict familiar-workspace reads reject ${malformed.name}`,
    );
  }

  const partiallyMalformed = `[[familiar]]
id = "ember"
workspace = "~/coven/ember"

[[familiar]]
id = "nova"
workspace = "/Users/example/nova
`;
  await writeFile(path.join(process.env.COVEN_HOME, "familiars.toml"), partiallyMalformed);
  await assert.rejects(
    () => readFamiliarWorkspacesStrict(),
    /unterminated/i,
    "strict familiar-workspace reads fail closed on partially written familiar blocks",
  );
  assert.deepEqual(
    Array.from((await readFamiliarWorkspaces()).entries()),
    Array.from(parseFamiliarWorkspaces(partiallyMalformed).entries()),
    "forgiving familiar-workspace reads stay aligned with the legacy parser for existing callers",
  );
} finally {
  await rm(strictScratch, { recursive: true, force: true });
  restoreEnv();
}
