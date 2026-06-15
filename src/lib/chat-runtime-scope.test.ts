// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  RuntimeScopeError,
  buildPromptWithRuntimeScope,
  buildRuntimeScopePreamble,
  resolveLocalRuntimeCwd,
} from "./chat-runtime-scope.ts";

const tempRoot = await mkdtemp(path.join(tmpdir(), "cave-runtime-scope-"));
const home = path.join(tempRoot, "home");
const repo = path.join(home, "repo");
const nested = path.join(repo, "packages", "app");
const outside = path.join(tempRoot, "elsewhere");
await mkdir(nested, { recursive: true });
await mkdir(outside, { recursive: true });
const filePath = path.join(home, "not-a-dir.txt");
await writeFile(filePath, "not a directory");

assert.equal(
  await resolveLocalRuntimeCwd(undefined, { homeDir: home }),
  realpathSync(home),
  "missing project root should default to the real home directory",
);

assert.equal(
  await resolveLocalRuntimeCwd(nested, { homeDir: home }),
  realpathSync(nested),
  "project roots inside home should resolve to their real directory",
);

await assert.rejects(
  () => resolveLocalRuntimeCwd(outside, { homeDir: home }),
  (error) =>
    error instanceof RuntimeScopeError &&
    error.code === "project_root_outside_home" &&
    /inside the local home directory/.test(error.message),
  "project roots outside home should be refused instead of downgraded to home",
);

await assert.rejects(
  () => resolveLocalRuntimeCwd(filePath, { homeDir: home }),
  (error) =>
    error instanceof RuntimeScopeError &&
    error.code === "project_root_not_directory",
  "non-directory project roots should be refused instead of downgraded to home",
);

await assert.rejects(
  () => resolveLocalRuntimeCwd(path.join(home, "missing"), { homeDir: home }),
  (error) =>
    error instanceof RuntimeScopeError &&
    error.code === "project_root_unavailable",
  "missing project roots should be refused instead of downgraded to home",
);

{
  const preamble = buildRuntimeScopePreamble({ kind: "local", root: repo });
  assert.match(preamble, /Runtime filesystem boundary:/);
  assert.match(preamble, new RegExp(repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(preamble, /Do not read, edit, create, delete, commit, push, or run commands against files outside this directory/);
  assert.match(preamble, /ask the user to reopen/);
}

{
  const preamble = buildRuntimeScopePreamble({
    kind: "ssh",
    host: "build-box",
    root: "/srv/cave",
  });
  assert.match(preamble, /build-box:\/srv\/cave/);
  assert.match(preamble, /remote runtime boundary/);
}

assert.equal(
  buildPromptWithRuntimeScope("hello", { kind: "local", root: repo }),
  `${buildRuntimeScopePreamble({ kind: "local", root: repo })}\n\nCurrent user message:\nhello`,
  "runtime scope should wrap the user prompt as explicit startup context",
);

console.log("chat-runtime-scope.test.ts: ok");
