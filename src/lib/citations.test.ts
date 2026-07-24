import assert from "node:assert/strict";
import test from "node:test";

import {
  domainFromUrl,
  parseCitations,
  renderCitedBody,
  sourceToCitation,
  sourcesToCitations,
} from "./citations.ts";

test("domainFromUrl strips the scheme and a leading www", () => {
  assert.equal(domainFromUrl("https://www.example.com/path?q=1"), "example.com");
  assert.equal(domainFromUrl("http://docs.rs/thing"), "docs.rs");
  assert.equal(domainFromUrl("not a url"), undefined);
  assert.equal(domainFromUrl(undefined), undefined);
});

test("sourceToCitation maps a research source row across", () => {
  const c = sourceToCitation(
    { id: "s1", title: "  Rust Book ", url: "https://doc.rust-lang.org/book/", claim: "Ownership rules." },
    3,
  );
  assert.deepEqual(c, {
    n: 3,
    id: "cite-3",
    title: "Rust Book",
    url: "https://doc.rust-lang.org/book/",
    domain: "doc.rust-lang.org",
    snippet: "Ownership rules.",
  });
  // Falls back: no title → domain; no claim → note; publisher stands in for domain.
  const bare = sourceToCitation({ url: "https://www.foo.io/x", note: "a note" }, 1);
  assert.equal(bare.title, "foo.io");
  assert.equal(bare.snippet, "a note");
  const local = sourceToCitation({ publisher: "Internal wiki", claim: "" }, 2);
  assert.equal(local.title, "Source 2");
  assert.equal(local.domain, "Internal wiki");
  assert.equal(sourcesToCitations([{ title: "A" }, { title: "B" }]).map((c) => c.n).join(","), "1,2");
});

test("parseCitations lifts markdown footnote definitions, numbered by first reference", () => {
  const text = [
    "The sky is blue [^blue] and grass is green [^green].",
    "",
    '[^green]: https://green.example "Chlorophyll"',
    "[^blue]: [Rayleigh scattering](https://sky.example/rayleigh)",
  ].join("\n");
  const { body, citations } = parseCitations(text);
  // Numbered by reference order (blue first), not definition order.
  assert.deepEqual(
    citations.map((c) => [c.n, c.title, c.url, c.domain]),
    [
      [1, "Rayleigh scattering", "https://sky.example/rayleigh", "sky.example"],
      [2, "Chlorophyll", "https://green.example", "green.example"],
    ],
  );
  // The definition block is stripped; inline markers stay in the body.
  assert.match(body, /\[\^blue\]/);
  assert.doesNotMatch(body, /\[\^green\]:/);
});

test("parseCitations understands angle, bare, and prose definition forms", () => {
  const text = [
    "a [^1] b [^2] c [^3]",
    "[^1]: <https://angle.example/p>",
    '[^2]: https://bare.example "Bare Title"',
    '[^3]: "Just a claim" with trailing prose',
  ].join("\n");
  const { citations } = parseCitations(text);
  assert.equal(citations[0].url, "https://angle.example/p");
  assert.equal(citations[0].title, "angle.example");
  assert.deepEqual([citations[1].title, citations[1].url], ["Bare Title", "https://bare.example"]);
  assert.deepEqual([citations[2].title, citations[2].url, citations[2].snippet], [
    "Just a claim",
    undefined,
    "with trailing prose",
  ]);
});

test("renderCitedBody rewrites inline refs to anchor links and passes plain text through", () => {
  const cited = renderCitedBody('see [^a] and [^b]\n\n[^a]: https://a.example\n[^b]: https://b.example');
  // [^a] → [1](#cite-1), [^b] → [2](#cite-2); definitions stripped.
  assert.match(cited.body, /see \[1\]\(#cite-1\) and \[2\]\(#cite-2\)/);
  assert.doesNotMatch(cited.body, /\[\^a\]:/);
  assert.equal(cited.citations.length, 2);
  // Plain text (no footnotes) is returned verbatim.
  const plain = renderCitedBody("nothing to cite here");
  assert.deepEqual(plain, { body: "nothing to cite here", citations: [] });
});

test("parseCitations is a no-op without footnotes and ignores unreferenced defs", () => {
  const plain = "just a normal message with [a link](https://x.example).";
  assert.deepEqual(parseCitations(plain), { body: plain, citations: [], order: new Map() });
  // A definition with no inline reference is dropped (nothing points at it).
  const orphan = "text\n\n[^unused]: https://nowhere.example";
  assert.deepEqual(parseCitations(orphan).citations, []);
});
