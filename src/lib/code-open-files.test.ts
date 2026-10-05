import assert from "node:assert/strict";
import { test } from "node:test";
import {
  closeCodeFile,
  codeOpenFileLabels,
  cycleCodeFile,
  emptyCodeOpenFiles,
  openCodeFile,
  sameCodePath,
  withDraftTabs,
} from "./code-open-files.ts";

test("opening appends new tabs in order and re-activates an existing one without reordering", () => {
  let state = openCodeFile(emptyCodeOpenFiles(), "/r/a.ts");
  state = openCodeFile(state, "/r/b.ts");
  state = openCodeFile(state, "/r/c.ts");
  assert.deepEqual(state, { paths: ["/r/a.ts", "/r/b.ts", "/r/c.ts"], active: "/r/c.ts" });
  const again = openCodeFile(state, "/r/a.ts");
  assert.deepEqual(again, { paths: ["/r/a.ts", "/r/b.ts", "/r/c.ts"], active: "/r/a.ts" });
  assert.equal(openCodeFile(again, "/r/a.ts"), again, "re-activating the active tab is a no-op");
  assert.equal(openCodeFile(again, ""), again, "an empty path opens nothing");
});

test("the strip is bounded: past the limit the oldest inactive tab is evicted", () => {
  let state = emptyCodeOpenFiles();
  for (const name of ["a", "b", "c"]) state = openCodeFile(state, `/r/${name}.ts`, 3);
  state = openCodeFile(state, "/r/d.ts", 3);
  assert.deepEqual(state.paths, ["/r/b.ts", "/r/c.ts", "/r/d.ts"]);
  assert.equal(state.active, "/r/d.ts");
});

test("closing the active tab lands on the left neighbour, or the right one when it was first", () => {
  let state = emptyCodeOpenFiles();
  for (const name of ["a", "b", "c"]) state = openCodeFile(state, `/r/${name}.ts`);
  state = openCodeFile(state, "/r/b.ts");
  state = closeCodeFile(state, "/r/b.ts");
  assert.deepEqual(state, { paths: ["/r/a.ts", "/r/c.ts"], active: "/r/a.ts" });
  state = closeCodeFile(state, "/r/a.ts");
  assert.deepEqual(state, { paths: ["/r/c.ts"], active: "/r/c.ts" });
  state = closeCodeFile(state, "/r/c.ts");
  assert.deepEqual(state, { paths: [], active: null });
});

test("closing an inactive tab keeps the active one; unknown paths are a no-op", () => {
  let state = emptyCodeOpenFiles();
  for (const name of ["a", "b"]) state = openCodeFile(state, `/r/${name}.ts`);
  const closed = closeCodeFile(state, "/r/a.ts");
  assert.deepEqual(closed, { paths: ["/r/b.ts"], active: "/r/b.ts" });
  assert.equal(closeCodeFile(closed, "/r/zzz.ts"), closed);
});

test("cycling wraps at both ends and does nothing with fewer than two tabs", () => {
  let state = emptyCodeOpenFiles();
  for (const name of ["a", "b", "c"]) state = openCodeFile(state, `/r/${name}.ts`);
  assert.equal(cycleCodeFile(state, 1).active, "/r/a.ts", "next from the last wraps to the first");
  assert.equal(cycleCodeFile(state, -1).active, "/r/b.ts");
  const one = openCodeFile(emptyCodeOpenFiles(), "/r/a.ts");
  assert.equal(cycleCodeFile(one, 1), one);
});

test("labels disambiguate same-named files with the shortest distinct parent", () => {
  const labels = codeOpenFileLabels(["/r/src/api/index.ts", "/r/src/ui/index.ts", "/r/README.md"]);
  assert.equal(labels.get("/r/src/api/index.ts"), "api/index.ts");
  assert.equal(labels.get("/r/src/ui/index.ts"), "ui/index.ts");
  assert.equal(labels.get("/r/README.md"), "README.md");
  const deep = codeOpenFileLabels(["/r/a/x/index.ts", "/r/b/x/index.ts"]);
  assert.equal(deep.get("/r/a/x/index.ts"), "a/x/index.ts");
  assert.equal(deep.get("/r/b/x/index.ts"), "b/x/index.ts");
});

test("unsaved drafts under the session's root get tabs; the active tab stays (#5756)", () => {
  const state = openCodeFile(emptyCodeOpenFiles(), "/r/a.ts");
  const next = withDraftTabs(state, ["/r/b.ts", "/other/c.ts", "/r/a.ts", "/rx/d.ts"], "/r");
  assert.deepEqual(next.paths, ["/r/a.ts", "/r/b.ts"], "only this root's drafts, once each; /rx is not under /r");
  assert.equal(next.active, "/r/a.ts");
  const fresh = withDraftTabs(emptyCodeOpenFiles(), ["/r/b.ts"], "/r/");
  assert.deepEqual(fresh, { paths: ["/r/b.ts"], active: "/r/b.ts" }, "with no tab open, the recovered draft is shown");
  assert.equal(withDraftTabs(state, ["/r/b.ts"], null), state, "no root, no change");
  // More drafts than the tab limit (#5760 review): every one keeps a tab.
  const many = Array.from({ length: 15 }, (_, i) => `/r/f${i}.ts`);
  assert.deepEqual(withDraftTabs(emptyCodeOpenFiles(), many, "/r").paths, many);
});

test("one file is one tab, whichever Unicode form opens it (#5795)", () => {
  const nfd = "/r/src/cafe\u0301.ts";
  const nfc = "/r/src/caf\u00e9.ts";
  assert.equal(sameCodePath(nfd, nfc), true);
  assert.equal(sameCodePath(nfc, "/r/src/cafe.ts"), false);
  assert.equal(sameCodePath(null, nfc), false);
  let state = openCodeFile(emptyCodeOpenFiles(), nfc);
  state = openCodeFile(state, "/r/README.md");
  state = openCodeFile(state, nfd);
  assert.deepEqual(state, { paths: [nfc, "/r/README.md"], active: nfc }, "the tab already open is activated, by its own spelling");
  const drafts = withDraftTabs(openCodeFile(emptyCodeOpenFiles(), nfc), [nfd], "/r");
  assert.deepEqual(drafts.paths, [nfc], "a recovered draft under another spelling gets no second tab");
  const underDecomposedRoot = withDraftTabs(emptyCodeOpenFiles(), ["/r/re\u0301sume\u0301/a.ts"], "/r/r\u00e9sum\u00e9");
  assert.deepEqual(underDecomposedRoot.paths, ["/r/re\u0301sume\u0301/a.ts"], "a root spelled the other way still holds its drafts");
});
