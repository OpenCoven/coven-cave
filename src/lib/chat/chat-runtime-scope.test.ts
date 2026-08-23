// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  RuntimeScopeError,
  buildRuntimeAccessFingerprint,
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

await assert.rejects(
  () => resolveLocalRuntimeCwd(undefined, { homeDir: home }),
  (error) =>
    error instanceof RuntimeScopeError &&
    error.code === "project_root_required" &&
    /refusing to start a homedir-scoped fallback session/.test(error.message),
  "missing project roots should be refused instead of downgraded to home",
);

assert.equal(
  await resolveLocalRuntimeCwd(nested, { homeDir: home }),
  realpathSync(nested),
  "project roots inside home should resolve to their real directory",
);

{
  const docs = path.join(home, "docs");
  const skills = path.join(home, ".agents");
  const first = buildRuntimeAccessFingerprint({
    primaryRoot: repo,
    grantedProjectRoots: [docs],
    projectRootAccess: { [docs]: "read" },
    additionalRoots: [skills],
  });
  const reordered = buildRuntimeAccessFingerprint({
    primaryRoot: `${repo}/`,
    grantedProjectRoots: [docs, docs],
    projectRootAccess: { [docs]: "read" },
    additionalRoots: [skills],
  });
  assert.equal(first, reordered, "equivalent grant sets have one stable fingerprint");
  assert.notEqual(
    first,
    buildRuntimeAccessFingerprint({
      primaryRoot: repo,
      grantedProjectRoots: [docs],
      projectRootAccess: { [docs]: "write" },
      additionalRoots: [skills],
    }),
    "an access-level change invalidates the native sandbox fingerprint",
  );
  assert.notEqual(
    first,
    buildRuntimeAccessFingerprint({
      primaryRoot: repo,
      grantedProjectRoots: [docs, path.join(home, "newly-approved")],
      projectRootAccess: { [docs]: "read" },
      additionalRoots: [skills],
    }),
    "a newly approved root invalidates the native sandbox fingerprint",
  );
}

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
  const docs = path.join(home, "docs");
  const preamble = buildRuntimeScopePreamble({
    kind: "local",
    root: repo,
    allowedProjectRoots: [repo, docs, repo],
  });
  assert.match(preamble, /Runtime filesystem boundary:/);
  assert.match(preamble, /Primary root:/);
  assert.match(preamble, /Granted project roots:/);
  assert.match(preamble, new RegExp(repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(preamble, new RegExp(docs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(
    preamble,
    /You may read, edit, create, delete, commit, push, and run commands inside the primary root and the granted project roots listed above/,
    "grant-aware local scopes should permit work inside every granted project root",
  );
  assert.doesNotMatch(
    preamble,
    /ask the user to reopen/,
    "grant-aware local scopes should not tell the familiar to reopen when another granted project is requested",
  );
  assert.equal(
    preamble.match(new RegExp(repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length,
    1,
    "duplicate allowed roots should be listed once",
  );
}

{
  const codexSkills = path.join(home, ".codex", "skills");
  const pluginCache = path.join(home, ".codex", "plugins", "cache");
  const preamble = buildRuntimeScopePreamble({
    kind: "local",
    root: repo,
    readOnlyResourceRoots: [codexSkills, pluginCache, codexSkills],
  });
  assert.match(preamble, /Read-only runtime resources:/);
  assert.match(
    preamble,
    new RegExp(codexSkills.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "installed skill roots should be declared readable even when no extra project is granted",
  );
  assert.match(
    preamble,
    new RegExp(pluginCache.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "plugin skill roots should be declared readable",
  );
  assert.match(
    preamble,
    /Runtime resources are read-only — read their instructions and assets, but do not edit, create, delete, commit, push, or run commands inside them/,
  );
  assert.equal(
    preamble.match(new RegExp(codexSkills.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length,
    1,
    "duplicate resource roots should be listed once",
  );
  assert.doesNotMatch(
    preamble,
    /ask the user to reopen/,
    "a local scope with readable resources should use the grant-aware boundary wording",
  );
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

{
  const docs = path.join(home, "docs");
  const readOnlyChild = path.join(home, "docs", "public");
  const preamble = buildRuntimeScopePreamble({
    kind: "local",
    root: repo,
    allowedProjectRoots: [repo, docs, readOnlyChild],
    projectRootAccess: { [docs]: "write", [readOnlyChild]: "read" },
  });
  assert.match(
    preamble,
    new RegExp(`${docs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(read \\+ write\\)`),
    "write-granted roots should render their level",
  );
  assert.match(
    preamble,
    new RegExp(`${readOnlyChild.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(read-only\\)`),
    "read-only roots should be annotated so the familiar doesn't assume write access",
  );
  assert.match(
    preamble,
    /Roots marked \(read-only\) above permit reading, browsing, and chatting only/,
    "a read-only root should trigger the caveat line",
  );
}

{
  const docs = path.join(home, "docs");
  const preamble = buildRuntimeScopePreamble({
    kind: "local",
    root: repo,
    allowedProjectRoots: [repo, docs],
    projectRootAccess: { [docs]: "write" },
  });
  assert.doesNotMatch(
    preamble,
    /read-only/,
    "an all-write grant set should not emit the read-only caveat line",
  );
}

assert.equal(
  buildPromptWithRuntimeScope("hello", { kind: "local", root: repo }),
  `${buildRuntimeScopePreamble({ kind: "local", root: repo })}\n\nCurrent user message:\nhello`,
  "runtime scope should wrap the user prompt as explicit startup context",
);

console.log("chat-runtime-scope.test.ts: ok");
