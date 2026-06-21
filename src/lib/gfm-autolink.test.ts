import assert from "node:assert/strict";
import test from "node:test";
import { gfmAutolink } from "./gfm-autolink.ts";

test("wraps a bare https URL in a markdown link", () => {
  assert.equal(
    gfmAutolink("see https://github.com/OpenCoven here"),
    "see [https://github.com/OpenCoven](https://github.com/OpenCoven) here",
  );
});

test("strips trailing sentence punctuation from the link", () => {
  assert.equal(
    gfmAutolink("docs at https://example.com/page."),
    "docs at [https://example.com/page](https://example.com/page).",
  );
});

test("keeps a balanced trailing paren inside the link but drops an unbalanced one", () => {
  assert.equal(
    gfmAutolink("(https://en.wikipedia.org/wiki/Foo_(bar))"),
    "([https://en.wikipedia.org/wiki/Foo_(bar)](https://en.wikipedia.org/wiki/Foo_(bar)))",
  );
});

test("links www. hosts with an https scheme", () => {
  assert.equal(
    gfmAutolink("visit www.example.com today"),
    "visit [www.example.com](https://www.example.com) today",
  );
});

test("links #123 issue refs only when a repo is provided", () => {
  assert.equal(gfmAutolink("fixes #42", { repo: "OpenCoven/coven-cave" }),
    "fixes [#42](https://github.com/OpenCoven/coven-cave/issues/42)");
  assert.equal(gfmAutolink("fixes #42"), "fixes #42");
});

test("links @mentions to GitHub profiles", () => {
  assert.equal(gfmAutolink("cc @octocat please"),
    "cc [@octocat](https://github.com/octocat) please");
});

test("leaves URLs inside inline code untouched", () => {
  assert.equal(
    gfmAutolink("run `curl https://example.com` now"),
    "run `curl https://example.com` now",
  );
});

test("leaves URLs inside fenced code untouched", () => {
  const md = "```\nhttps://example.com\n```";
  assert.equal(gfmAutolink(md), md);
});

test("does not double-wrap an existing markdown link", () => {
  const md = "[the site](https://example.com)";
  assert.equal(gfmAutolink(md), md);
});

test("does not rewrite an existing angle-bracket autolink", () => {
  const md = "<https://example.com>";
  assert.equal(gfmAutolink(md), md);
});

test("preserves a reference-style link definition", () => {
  const md = "[ref]: https://example.com";
  assert.equal(gfmAutolink(md), md);
});

test("autolinks across a real GFM comment with code and prose", () => {
  const input = [
    "Thanks! See https://ci.example.com/run/9 for logs.",
    "",
    "```bash",
    "open https://nope.example.com",
    "```",
    "",
    "cc @reviewer — closes #7",
  ].join("\n");
  const out = gfmAutolink(input, { repo: "OpenCoven/coven-cave" });
  assert.match(out, /\[https:\/\/ci\.example\.com\/run\/9\]\(https:\/\/ci\.example\.com\/run\/9\)/);
  assert.match(out, /open https:\/\/nope\.example\.com/); // untouched in code
  assert.match(out, /\[@reviewer\]\(https:\/\/github\.com\/reviewer\)/);
  assert.match(out, /\[#7\]\(https:\/\/github\.com\/OpenCoven\/coven-cave\/issues\/7\)/);
});
