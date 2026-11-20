// @ts-nocheck
// A one-shot run's cwd comes from a familiar id in a request body, so the
// workspace it resolves must stay inside the real familiars root unless the
// owner declared it in familiars.toml (#6374). These cases run against real
// directories, symlinks and (on macOS) the /tmp -> /private/tmp alias.
import assert from "node:assert/strict";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Prefer /tmp so macOS exercises its /tmp -> /private/tmp alias; elsewhere the
// alias case degrades to an ordinary path and the other cases still apply.
const base = existsSync("/tmp") ? "/tmp" : tmpdir();
const home = await mkdtemp(path.join(base, "oneshot-workspace-"));
const outside = await mkdtemp(path.join(base, "oneshot-outside-"));
const previous = {
  HOME: process.env.HOME,
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_WORKSPACES_ROOT: process.env.COVEN_WORKSPACES_ROOT,
};
process.env.HOME = home;
process.env.COVEN_HOME = path.join(home, ".coven");
delete process.env.COVEN_WORKSPACES_ROOT;

try {
  const familiars = path.join(home, ".coven", "workspaces", "familiars");
  await mkdir(path.join(familiars, "nova"), { recursive: true });
  await mkdir(path.join(familiars, "shared-target"), { recursive: true });
  await writeFile(path.join(familiars, "not-a-dir"), "file");
  // A symlink that leaves the root, and one that stays inside it.
  await symlink(outside, path.join(familiars, "escape"));
  await symlink(path.join(familiars, "shared-target"), path.join(familiars, "inside-link"));
  // A symlink that points at the root itself is not a familiar's workspace.
  await symlink(familiars, path.join(familiars, "root-link"));

  const { resolveFamiliarWorkspace } = await import("./coven-oneshot.ts");
  const realRoot = await realpath(familiars);

  assert.equal(
    await resolveFamiliarWorkspace("nova"),
    path.join(realRoot, "nova"),
    "a workspace inside the root resolves to its real path (macOS: /private/tmp, not the /tmp alias)",
  );
  if (realRoot !== familiars) {
    assert.ok(
      !(await resolveFamiliarWorkspace("nova")).startsWith(familiars + path.sep),
      "the alias spelling of the root never reaches the spawn cwd",
    );
  }

  for (const id of ["..", "../outside", "nova/..", "a/b", ".", "", "nova\0"]) {
    assert.equal(await resolveFamiliarWorkspace(id), undefined, `${JSON.stringify(id)} is rejected`);
  }
  assert.equal(await resolveFamiliarWorkspace("escape"), undefined, "a symlink out of the root is rejected");
  assert.equal(await resolveFamiliarWorkspace("root-link"), undefined, "a symlink to the root itself is rejected");
  assert.equal(
    await resolveFamiliarWorkspace("inside-link"),
    path.join(realRoot, "shared-target"),
    "a symlink that stays inside the root resolves to its real target",
  );
  assert.equal(await resolveFamiliarWorkspace("not-a-dir"), undefined, "a file is not a workspace");
  assert.equal(await resolveFamiliarWorkspace("missing"), undefined, "an absent workspace is undefined");

  // The owner's familiars.toml may place a workspace anywhere; it still
  // resolves to a real directory.
  const declared = path.join(outside, "declared");
  await mkdir(declared, { recursive: true });
  await writeFile(
    path.join(home, ".coven", "familiars.toml"),
    `[[familiar]]\nid = "lucian"\nworkspace = "${declared}"\n`,
  );
  assert.equal(
    await resolveFamiliarWorkspace("lucian"),
    realpathSync(declared),
    "a declared workspace resolves to its real path",
  );
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(home, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
}

console.log("coven-oneshot-workspace.test.ts: ok");
