// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isValidFamiliarId,
  readFamiliarContractFiles,
} from "./familiar-contract-files.ts";

// Accepts ordinary familiar slugs.
for (const ok of ["sage", "echo", "kitty", "nova", "my-familiar", "agent_01", "A1"]) {
  assert.equal(isValidFamiliarId(ok), true, `${ok} should be a valid familiar id`);
}

// Rejects anything that could escape the workspace root or smuggle a path.
for (const bad of [
  "",
  "..",
  "../etc",
  "../../etc/passwd",
  "sage/../echo",
  "a/b",
  "a\\b",
  ".hidden",
  "-leading-dash",
  "with space",
  "name.with.dots",
  "x".repeat(65),
]) {
  assert.equal(isValidFamiliarId(bad), false, `${JSON.stringify(bad)} must be rejected`);
}

await assert.rejects(
  readFamiliarContractFiles("../outside"),
  /invalid familiar id/,
  "the filesystem reader must reject traversal before resolving a workspace",
);

const originalCovenHome = process.env.COVEN_HOME;
const root = await mkdtemp(path.join(tmpdir(), "coven-contract-files-"));
const declaredWorkspace = path.join(root, "declared-workspace");

try {
  process.env.COVEN_HOME = root;
  await mkdir(declaredWorkspace, { recursive: true });
  await writeFile(
    path.join(root, "familiars.toml"),
    `[[familiar]]\nid = "voice_agent"\nworkspace = "${declaredWorkspace}"\n`,
    "utf8",
  );
  await writeFile(path.join(declaredWorkspace, "SOUL.md"), "declared soul", "utf8");
  await writeFile(path.join(declaredWorkspace, "IDENTITY.md"), "declared identity", "utf8");
  await writeFile(path.join(declaredWorkspace, "ward.toml"), "[ward]", "utf8");
  await writeFile(path.join(declaredWorkspace, "MEMORY.md"), "declared memory", "utf8");

  const loaded = await readFamiliarContractFiles("voice_agent");
  assert.equal(loaded.workspace, declaredWorkspace, "sanitizing the id must preserve declared workspaces");
  assert.deepEqual(loaded.files, {
    soul: "declared soul",
    identity: "declared identity",
    ward: "[ward]",
    memory: "declared memory",
  });
} finally {
  if (originalCovenHome === undefined) {
    delete process.env.COVEN_HOME;
  } else {
    process.env.COVEN_HOME = originalCovenHome;
  }
  await rm(root, { recursive: true, force: true });
}

console.log("familiar-contract-files.test.ts: ok");
