import assert from "node:assert/strict";
import { test } from "node:test";

import {
  nativeProjectPathsEqual,
  resolveNativeRepoRelativePathWithinProject,
  resolveNativePathWithinRoot,
  resolveNativeProjectPathForGitRoot,
} from "./native-project-path.ts";

test("POSIX authorization preserves backslashes and surrounding whitespace exactly", () => {
  assert.equal(
    nativeProjectPathsEqual("/repo/packages/app\\name", "/repo/packages/app/name", "linux"),
    false,
    "a POSIX backslash is a filename character, not a separator",
  );
  assert.equal(
    nativeProjectPathsEqual("/repo/packages/app ", "/repo/packages/app", "linux"),
    false,
    "POSIX trailing whitespace is part of the filename",
  );
  assert.deepEqual(
    resolveNativeProjectPathForGitRoot(
      "/repo/packages/app\\name",
      "/repo",
      "/repo/packages/app\\name/src/a.ts",
      "linux",
    ),
    {
      absolutePath: "/repo/packages/app\\name/src/a.ts",
      projectRelativePath: "src/a.ts",
      gitRelativePath: "packages/app\\name/src/a.ts",
    },
  );
  assert.equal(
    resolveNativeProjectPathForGitRoot(
      "/repo/packages/app/name",
      "/repo",
      "/repo/packages/app\\name/src/a.ts",
      "linux",
    ),
    null,
    "/repo/packages/app\\name must not authorize /repo/packages/app/name",
  );
  assert.deepEqual(
    resolveNativeProjectPathForGitRoot(
      "/repo/packages/app ",
      "/repo",
      "/repo/packages/app /src/file.ts ",
      "linux",
    ),
    {
      absolutePath: "/repo/packages/app /src/file.ts ",
      projectRelativePath: "src/file.ts ",
      gitRelativePath: "packages/app /src/file.ts ",
    },
    "non-whitespace POSIX roots and targets retain trailing spaces",
  );
  assert.equal(
    resolveNativePathWithinRoot("/repo/packages/app ", "   ", "linux"),
    null,
    "whitespace-only targets are rejected without trimming valid path bytes",
  );
  assert.equal(
    resolveNativePathWithinRoot("/repo/packages/app ", "src/\tfile.ts", "linux"),
    null,
    "control-bearing targets fail closed",
  );
});

test("Windows authorization normalizes separators and case with segment boundaries", () => {
  assert.equal(
    nativeProjectPathsEqual("C:\\Repo\\App\\", "c:/repo/APP", "win32"),
    true,
  );
  assert.equal(
    nativeProjectPathsEqual("\\\\Server\\Share\\Repo", "//server/share/REPO/", "win32"),
    true,
  );
  assert.deepEqual(
    resolveNativeProjectPathForGitRoot(
      "C:\\Repo\\Packages\\App",
      "c:/repo",
      "c:/REPO/packages/APP/src\\File.ts",
      "win32",
    ),
    {
      absolutePath: "C:\\Repo\\Packages\\App\\src\\File.ts",
      projectRelativePath: "src\\File.ts",
      gitRelativePath: "Packages/App/src/File.ts",
    },
  );
  assert.equal(
    resolveNativePathWithinRoot("C:\\Repo\\App", "C:\\Repo\\Application\\file.ts", "win32"),
    null,
  );
  assert.equal(
    resolveNativePathWithinRoot("C:\\Repo\\App", "..\\outside.ts", "win32"),
    null,
  );
  assert.equal(
    resolveNativePathWithinRoot("C:\\Repo\\App", "C:relative\\file.ts", "win32"),
    null,
    "drive-relative spellings are not resolved against process drive state",
  );
  assert.equal(
    resolveNativePathWithinRoot(
      "\\\\Server\\Share\\Repo",
      "\\\\server\\share-other\\Repo\\file.ts",
      "win32",
    ),
    null,
  );
});

test("repo-relative project eligibility rejects parent and sibling boundaries cross-platform", () => {
  assert.deepEqual(
    resolveNativeRepoRelativePathWithinProject(
      "C:\\Repo\\Packages\\App",
      "c:\\repo",
      "packages/app/src/File.ts",
      "win32",
    ),
    {
      absolutePath: "C:\\Repo\\Packages\\App\\src\\File.ts",
      projectRelativePath: "src\\File.ts",
      gitRelativePath: "Packages/App/src/File.ts",
    },
  );
  for (const outside of [
    "src/parent.ts",
    "packages/sibling/src/File.ts",
    "packages/application/src/File.ts",
    "../outside.ts",
    "C:\\Repo\\Packages\\App\\src\\absolute.ts",
  ]) {
    assert.equal(
      resolveNativeRepoRelativePathWithinProject(
        "C:\\Repo\\Packages\\App",
        "c:\\repo",
        outside,
        "win32",
      ),
      null,
      `${outside} is not an eligible repo-relative nested-project path`,
    );
  }

  assert.deepEqual(
    resolveNativeRepoRelativePathWithinProject(
      "/repo/packages/app",
      "/repo",
      "packages/app/src/file.ts",
      "linux",
    ),
    {
      absolutePath: "/repo/packages/app/src/file.ts",
      projectRelativePath: "src/file.ts",
      gitRelativePath: "packages/app/src/file.ts",
    },
  );
  assert.equal(
    resolveNativeRepoRelativePathWithinProject(
      "/repo/packages/app",
      "/repo",
      "packages/app-other/src/file.ts",
      "linux",
    ),
    null,
    "a shared string prefix is not a project path boundary",
  );
});
