import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findConflictMarkers, parseMarkerHits } from "./check-conflict-markers.mjs";

const CHECK = fileURLToPath(new URL("./check-conflict-markers.mjs", import.meta.url));

function fixtureRepo(files) {
  const root = mkdtempSync(path.join(tmpdir(), "conflict-marker-"));
  execFileSync("git", ["init", "-q", "."], { cwd: root });
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(root, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  execFileSync("git", ["add", "-A"], { cwd: root });
  return root;
}

test("an unresolved conflict block is reported with file and line", () => {
  const root = fixtureRepo({
    "src/broken.ts": "const a = 1;\n<<<<<<< HEAD\nconst b = 2;\n=======\nconst b = 3;\n>>>>>>> other\n",
  });
  try {
    const hits = findConflictMarkers(root);
    assert.deepEqual(
      hits.map((hit) => [hit.file, hit.line]),
      [["src/broken.ts", 2], ["src/broken.ts", 6]],
      "both the opening and closing marker are reported",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a clean tree reports nothing", () => {
  const root = fixtureRepo({ "src/fine.ts": "const a = 1;\n" });
  try {
    assert.deepEqual(findConflictMarkers(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The whole reason this guard narrows to `<<<<<<<` and `>>>>>>>`: seven `=` at
// the start of a line is a Markdown setext H1 underline, so a bare `=======`
// cannot be a failure condition without breaking ordinary documentation.
test("legitimate line-start text is not mistaken for a marker", () => {
  const root = fixtureRepo({
    "docs/page.md": "Title\n=======\n\nSetext H1 underlines are seven equals signs.\n",
    "docs/rule.md": "Section\n=================================\n",
    "src/quoted.ts": 'const opening = "<<<<<<<";\nconst closing = ">>>>>>>";\n',
    "src/indented.ts": "function f() {\n  <<<<<<< not at line start\n}\n",
    "src/arrows.ts": "const shifted = 1 >>>>>>> 2;\nconst compare = a <<<<<<< b;\n",
  });
  try {
    assert.deepEqual(findConflictMarkers(root), [], "no false positive survives");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a marker with no trailing label still fails", () => {
  const root = fixtureRepo({ "src/bare.ts": "<<<<<<<\nconst a = 1;\n>>>>>>>\n" });
  try {
    assert.deepEqual(
      findConflictMarkers(root).map((hit) => hit.line),
      [1, 3],
      "git writes a label, but a hand-edited marker without one is still unresolved",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the CLI exits non-zero on a dirty tree and zero on a clean one", () => {
  const dirty = fixtureRepo({ "a.ts": "<<<<<<< HEAD\n" });
  const clean = fixtureRepo({ "a.ts": "const a = 1;\n" });
  try {
    assert.throws(
      () => execFileSync(process.execPath, [CHECK], { cwd: dirty, stdio: "pipe" }),
      (error) => error.status === 1,
      "a gate that cannot fail is not a gate",
    );
    execFileSync(process.execPath, [CHECK], { cwd: clean, stdio: "pipe" });
  } finally {
    rmSync(dirty, { recursive: true, force: true });
    rmSync(clean, { recursive: true, force: true });
  }
});

// `git grep -z` separates path, line and text with NUL rather than `:`. The
// first version of this checker split on `:` instead, matched nothing, and so
// reported a clean tree for a fixture full of markers.
test("NUL-separated records parse, and a malformed one throws rather than reporting clean", () => {
  // A real NUL, written as an escape: a raw one makes this file read as
  // binary to grep and to `git grep -I`, and `\0` before a digit is an
  // octal escape that ESM rejects in strict mode.
  const NUL = "\u0000";
  assert.deepEqual(
    parseMarkerHits(`src/a.ts${NUL}2${NUL}<<<<<<< HEAD\n`),
    [{ file: "src/a.ts", line: 2, text: "<<<<<<< HEAD" }],
  );
  assert.deepEqual(
    parseMarkerHits(`weird:name.ts${NUL}9${NUL}>>>>>>> x\n`)[0].file,
    "weird:name.ts",
    "a colon in the path must not be read as a field separator",
  );
  assert.throws(() => parseMarkerHits("src/a.ts:2:<<<<<<< HEAD\n"), /unparseable/);
  assert.throws(() => parseMarkerHits(`src/a.ts${NUL}notanumber${NUL}x\n`), /unparseable/);
});

console.log("check-conflict-markers.test.mjs: ok");
