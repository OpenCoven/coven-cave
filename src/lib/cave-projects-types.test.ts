import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dedupeAbsoluteProjectPaths,
  normalizeProjectRoot,
  projectPathIdentityKey,
  resolveProjectPathForGitRoot,
  resolvePathWithinProjectRoot,
} from "./cave-projects-types.ts";

test("project containment follows case-insensitive Windows drive semantics", () => {
  assert.equal(normalizeProjectRoot("C:\\"), "C:/");
  assert.equal(normalizeProjectRoot("C:"), "C:/", "legacy server drive roots migrate to drive-root form");
  assert.equal(normalizeProjectRoot("c:////"), "c:/");
  assert.equal(normalizeProjectRoot("\\\\Server\\Share\\"), "//Server/Share");
  assert.deepEqual(
    resolvePathWithinProjectRoot("C:\\Repo\\App", "c:/repo/APP/src\\File.ts"),
    {
      absolutePath: "C:/Repo/App/src/File.ts",
      relativePath: "src/File.ts",
    },
  );
  assert.equal(resolvePathWithinProjectRoot("C:\\Repo\\App", "C:\\Repo\\AppSibling\\file.ts"), null);
  assert.equal(resolvePathWithinProjectRoot("C:\\Repo\\App", "D:\\Repo\\App\\file.ts"), null);
  assert.equal(resolvePathWithinProjectRoot("C:\\Repo\\App", "C:relative\\file.ts"), null);
  assert.equal(resolvePathWithinProjectRoot("C:\\Repo\\App", "\\\\?\\C:\\Repo\\App\\file.ts"), null);
  assert.equal(resolvePathWithinProjectRoot("C:\\Repo\\App", "..\\outside.ts"), null);
  assert.equal(resolvePathWithinProjectRoot("C:\\Repo\\App", "src\\..\\..\\outside.ts"), null);
});

test("project containment preserves UNC roots and compares them case-insensitively", () => {
  assert.deepEqual(
    resolvePathWithinProjectRoot(
      "\\\\Server\\Share\\Repo",
      "//server/share/REPO/src\\File.ts",
    ),
    {
      absolutePath: "//Server/Share/Repo/src/File.ts",
      relativePath: "src/File.ts",
    },
  );
  assert.equal(
    resolvePathWithinProjectRoot("\\\\Server\\Share\\Repo", "\\\\server\\share-other\\Repo\\file.ts"),
    null,
  );
  assert.equal(
    resolvePathWithinProjectRoot("\\\\Server\\Share\\Repo", "\\\\server\\share\\RepoSibling\\file.ts"),
    null,
  );
  assert.equal(resolvePathWithinProjectRoot("\\\\Server\\Share\\Repo", "..\\outside.ts"), null);
  assert.equal(
    resolvePathWithinProjectRoot("\\\\Server\\Share\\Repo", "///server/share/Repo/file.ts"),
    null,
  );
});

test("POSIX containment remains case-sensitive and segment-bound", () => {
  assert.deepEqual(resolvePathWithinProjectRoot("/repo/app", "src/../src/file.ts"), {
    absolutePath: "/repo/app/src/file.ts",
    relativePath: "src/file.ts",
  });
  assert.equal(resolvePathWithinProjectRoot("/repo/app", "/repo/application/file.ts"), null);
  assert.equal(resolvePathWithinProjectRoot("/Repo/App", "/repo/app/file.ts"), null);
  assert.equal(resolvePathWithinProjectRoot("/repo/app", "../../outside.ts"), null);
});

test("absolute project path dedupe follows each platform's case semantics", () => {
  assert.deepEqual(
    dedupeAbsoluteProjectPaths([
      "C:/Repo/App/src/File.ts",
      "c:\\repo\\app\\SRC\\file.ts",
      "//Server/Share/Repo/src/Other.ts",
      "\\\\server\\share\\repo\\SRC\\other.ts",
    ]),
    ["C:/Repo/App/src/File.ts", "//Server/Share/Repo/src/Other.ts"],
  );
  assert.deepEqual(
    dedupeAbsoluteProjectPaths(["/Repo/App/File.ts", "/repo/app/file.ts"]),
    ["/Repo/App/File.ts", "/repo/app/file.ts"],
  );
});

test("project path identity follows Windows and POSIX case semantics", () => {
  assert.equal(projectPathIdentityKey("C:/Repo/App"), projectPathIdentityKey("c:\\repo\\APP\\"));
  assert.equal(
    projectPathIdentityKey("//Server/Share/Repo"),
    projectPathIdentityKey("\\\\server\\share\\REPO\\"),
  );
  assert.notEqual(projectPathIdentityKey("/Repo/App"), projectPathIdentityKey("/repo/app"));
});

test("nested project targets become git-root-relative only after project containment", () => {
  assert.deepEqual(
    resolveProjectPathForGitRoot(
      "/repo/packages/app",
      "/repo",
      "/repo/packages/app/src/a.ts",
    ),
    {
      absolutePath: "/repo/packages/app/src/a.ts",
      projectRelativePath: "src/a.ts",
      gitRelativePath: "packages/app/src/a.ts",
    },
  );
  assert.equal(
    resolveProjectPathForGitRoot("/repo/packages/app", "/repo", "/repo/src/a.ts"),
    null,
    "/repo/packages/app/src/a.ts must never collapse onto /repo/src/a.ts",
  );
});
