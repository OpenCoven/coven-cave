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
  runtimeGrantDirs,
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

// #6356: an accessible read-only directory must not become a writable
// --add-dir authority merely because it is visible in the boundary preamble.
assert.deepEqual(
  runtimeGrantDirs({
    spawnRoot: repo,
    grantedProjectRoots: [outside, nested],
    projectRootAccess: { [outside]: "read", [nested]: "write" },
  }),
  [nested],
  "only explicit writable project roots are forwarded to the harness",
);

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
    buildRuntimeAccessFingerprint({ primaryRoot: repo, grantedProjectRoots: [], permissionMode: "read" }),
    buildRuntimeAccessFingerprint({ primaryRoot: repo, grantedProjectRoots: [], permissionMode: "full" }),
    "changing the permission mode must replace stale native session authority",
  );
  assert.notEqual(
    buildRuntimeAccessFingerprint({ primaryRoot: repo, grantedProjectRoots: [], readOnlyResourceRoots: [] }),
    buildRuntimeAccessFingerprint({ primaryRoot: repo, grantedProjectRoots: [], readOnlyResourceRoots: [skills] }),
    "a change to protected runtime resources must invalidate native authority",
  );
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

assert.equal(
  await resolveLocalRuntimeCwd(outside, {
    homeDir: home,
    rootAuthority: "authorized-project",
  }),
  realpathSync(outside),
  "an already-authorized project root may live outside home",
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

// REGRESSION (#6210): the spawn root arrives realpathed, while a granted
// project keeps its registered spelling. A project registered through an alias
// of the spawn directory (macOS /tmp -> /private/tmp) must not be forwarded
// back to the harness as a second --add-dir grant of its own cwd.
{
  const aliasBase = realpathSync(await mkdtemp(path.join(tmpdir(), "cave-grant-dirs-")));
  const realParent = path.join(aliasBase, "real");
  const spawn = path.join(realParent, "primary");
  const extra = path.join(realParent, "extra");
  const workspace = path.join(aliasBase, "workspace");
  await mkdir(spawn, { recursive: true });
  await mkdir(extra, { recursive: true });
  await mkdir(workspace, { recursive: true });
  const { symlinkSync } = await import("node:fs");
  symlinkSync(realParent, path.join(aliasBase, "alias"));
  const aliasSpawn = path.join(aliasBase, "alias", "primary");
  const aliasExtra = path.join(aliasBase, "alias", "extra");
  const elsewhereLink = path.join(aliasBase, "link-to-extra");
  symlinkSync(extra, elsewhereLink);

  assert.deepEqual(
    runtimeGrantDirs({
      spawnRoot: spawn,
      grantedProjectRoots: [aliasSpawn, aliasExtra, ` ${spawn} `, "", aliasExtra],
      familiarWorkspace: workspace,
    }),
    [aliasExtra, workspace],
    "the spawn root is excluded by canonical identity; other grants keep their registered spelling",
  );
  assert.deepEqual(
    runtimeGrantDirs({
      spawnRoot: spawn,
      grantedProjectRoots: [extra, aliasExtra, workspace],
      projectRootAccess: { [extra]: "read", [aliasExtra]: "write" },
    }),
    [aliasExtra],
    "a writable alias remains writable while read-only and unknown grants are excluded",
  );
  assert.deepEqual(
    runtimeGrantDirs({ spawnRoot: spawn, grantedProjectRoots: [extra], projectRootAccess: {} }),
    [],
    "a missing level in an explicit access map must not create write authority",
  );
  assert.deepEqual(
    runtimeGrantDirs({ spawnRoot: spawn, grantedProjectRoots: [elsewhereLink] }),
    [elsewhereLink],
    "a symlinked grant that names another directory is still forwarded",
  );
  assert.deepEqual(
    runtimeGrantDirs({ spawnRoot: spawn, grantedProjectRoots: [], familiarWorkspace: aliasSpawn }),
    [],
    "a familiar workspace that is the spawn directory is not forwarded again",
  );
  assert.deepEqual(
    runtimeGrantDirs({ spawnRoot: spawn, grantedProjectRoots: [aliasExtra, extra, elsewhereLink] }),
    [aliasExtra],
    "one directory is forwarded once, under the first spelling granted",
  );

  // On a case-insensitive volume the spawn cwd carries the on-disk case, and a
  // grant typed in another case is the same directory.
  await mkdir(path.join(aliasBase, "CaseProbe"));
  const { existsSync } = await import("node:fs");
  if (existsSync(path.join(aliasBase, "caseprobe"))) {
    const onDisk = path.join(realParent, "MyProj");
    await mkdir(onDisk);
    const spawnOnDisk = realpathSync.native(path.join(realParent, "myproj"));
    assert.equal(spawnOnDisk, onDisk, "the native realpath reports the on-disk case");
    assert.deepEqual(
      runtimeGrantDirs({ spawnRoot: spawnOnDisk, grantedProjectRoots: [path.join(aliasBase, "alias", "myproj"), extra] }),
      [extra],
      "a grant of the spawn directory in another letter case is not forwarded again",
    );
  }

  // REGRESSION (#6216): the runtime-scope preamble lists each granted
  // directory once and never repeats the primary root. Spellings of one
  // directory merge to the most permissive level, shown under a spelling that
  // holds it.
  const preamble = buildRuntimeScopePreamble({
    kind: "local",
    root: spawn,
    allowedProjectRoots: [aliasSpawn, extra, aliasExtra],
    projectRootAccess: { [aliasSpawn]: "write", [extra]: "read", [aliasExtra]: "write" },
    readOnlyResourceRoots: [aliasSpawn, workspace],
  });
  const rootLines = preamble.split("\n").filter((line) => line.startsWith("  - "));
  assert.deepEqual(
    rootLines,
    [`  - ${aliasExtra} (read + write)`, `  - ${workspace} (read-only)`],
    "an alias of the primary root and a second spelling of a grant are not listed again",
  );
  assert.doesNotMatch(
    preamble,
    /Roots marked \(read-only\) above permit reading/,
    "a directory granted write under any spelling is not described as read-only",
  );

  // Preserve #6216's spelling comparison. Version 2 deliberately refreshes
  // legacy sessions once to bind permission mode and protected resources.
  assert.equal(
    buildRuntimeAccessFingerprint({ primaryRoot: spawn, grantedProjectRoots: [aliasSpawn] }),
    JSON.stringify({ version: 2, primaryRoot: spawn, permissionMode: "full", readOnlyResourceRoots: [], roots: [{ root: aliasSpawn, access: "write" }] }),
    "the new fingerprint preserves registered spellings while binding authority",
  );

  // CI runs on case-sensitive Linux, where the case-variant check above is
  // skipped. Simulate a case-insensitive volume by folding one directory's
  // case in the native realpath, so the spawn-root exclusion is guarded on
  // every platform.
  const folded = path.join(realParent, "Folded");
  await mkdir(folded);
  const typedFolded = path.join(realParent, "folded");
  const nativeBefore = realpathSync.native;
  const fold = (value) => {
    const text = String(value);
    return text === typedFolded || text.startsWith(typedFolded + path.sep) ? folded + text.slice(typedFolded.length) : text;
  };
  const { mock } = await import("node:test");
  mock.method(realpathSync, "native", (value, ...rest) => nativeBefore(fold(value), ...rest));
  try {
    assert.deepEqual(
      runtimeGrantDirs({ spawnRoot: folded, grantedProjectRoots: [typedFolded, extra] }),
      [extra],
      "(simulated case-insensitive volume) a grant of the spawn directory in another case is not forwarded again",
    );
  } finally {
    mock.restoreAll();
  }
}

console.log("chat-runtime-scope.test.ts: ok");
