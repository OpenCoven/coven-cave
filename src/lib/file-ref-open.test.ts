// @ts-nocheck
import assert from "node:assert/strict";

const { isMarkdownRefPath, openFileRef, fileRefLinkTitle } = await import("./file-ref-open.ts");

// ── isMarkdownRefPath ───────────────────────────────────────────────────────
assert.equal(isMarkdownRefPath("docs/superpowers/plans/2026-08-08-calm.md"), true);
assert.equal(isMarkdownRefPath("README.MD"), true, "extension match is case-insensitive");
assert.equal(isMarkdownRefPath("notes/page.markdown"), true);
assert.equal(isMarkdownRefPath("site/page.mdx"), true);
assert.equal(isMarkdownRefPath("src/foo.ts"), false);
assert.equal(isMarkdownRefPath("src/md.ts"), false, "a path that merely contains 'md' is not markdown");

// A dispatcher that records calls; `claim` names the event a listener cancels.
function recorder(claim) {
  const seen = [];
  return {
    seen,
    dispatch: (name, init) => {
      seen.push({ name, ...init });
      return name !== claim; // false == preventDefault(), i.e. claimed
    },
  };
}

// ── A claimed markdown ref reads in chat and NEVER reaches the Code route ───
{
  const rec = recorder("cave:open-markdown-document");
  const where = openFileRef({ path: "docs/plan.md" }, rec.dispatch);
  assert.equal(where, "chat-reader");
  assert.deepEqual(
    rec.seen.map((e) => e.name),
    ["cave:open-markdown-document"],
    "a claimed document must not also open in the Code workspace",
  );
  assert.equal(rec.seen[0].cancelable, true, "the offer has to be cancelable to be claimable");
  assert.deepEqual(rec.seen[0].detail, { path: "docs/plan.md", line: undefined });
}

// ── An UNCLAIMED markdown ref still opens in the Code workspace ─────────────
{
  const rec = recorder(null);
  const where = openFileRef({ path: "docs/plan.md", line: 12 }, rec.dispatch);
  assert.equal(where, "code-workspace");
  assert.deepEqual(
    rec.seen.map((e) => e.name),
    ["cave:open-markdown-document", "cave:open-project-file"],
    "a surface with no chat reader keeps the affordance it always had",
  );
  assert.deepEqual(rec.seen[1].detail, { path: "docs/plan.md", line: 12 }, "the line survives the fallback");
}

// ── A non-markdown ref never even offers itself to the reader ───────────────
{
  const rec = recorder("cave:open-markdown-document");
  const where = openFileRef({ path: "src/foo.ts", line: 42 }, rec.dispatch);
  assert.equal(where, "code-workspace");
  assert.deepEqual(rec.seen.map((e) => e.name), ["cave:open-project-file"]);
  assert.equal(rec.seen[0].cancelable, undefined, "the Code route is not a negotiation");
}

// ── The tooltip names the real destination ──────────────────────────────────
assert.equal(fileRefLinkTitle({ path: "docs/plan.md" }), "Open docs/plan.md in the chat reader");
assert.equal(
  fileRefLinkTitle({ path: "src/foo.ts", line: 9 }),
  "Open src/foo.ts:9 in the Code workspace",
);

console.log("file-ref-open.test.ts: ok");
