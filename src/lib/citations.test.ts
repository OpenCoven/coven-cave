import assert from "node:assert/strict";
import test from "node:test";

import {
  citationInlineLabel,
  citationSourcePresentation,
  domainFromUrl,
  lineRangeLabel,
  parseCitations,
  parseCitationFileRef,
  renderCitedBody,
  renderCitationReferences,
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

test("parseCitations preserves a brief source summary after the title", () => {
  const text = [
    "A cited claim[^1].",
    "",
    '[^1]: https://example.com/report "Annual report" — Explains the year-over-year result.',
  ].join("\n");

  const { citations } = parseCitations(text);

  assert.equal(citations[0].snippet, "Explains the year-over-year result.");
});

test("citationSourcePresentation identifies GitHub resources", () => {
  const pullRequest = citationSourcePresentation({
    n: 1,
    id: "cite-1",
    title: "Inline source previews",
    url: "https://github.com/OpenCoven/coven-cave/pull/4102",
    domain: "github.com",
  });
  const commit = citationSourcePresentation({
    n: 2,
    id: "cite-2",
    title: "Fix citation rendering",
    url: "https://github.com/OpenCoven/coven-cave/commit/1234567890abcdef",
    domain: "github.com",
  });

  assert.equal(pullRequest.kind, "github");
  assert.equal(pullRequest.provider, "GitHub");
  assert.equal(pullRequest.context, "OpenCoven/coven-cave · Pull request #4102");
  assert.match(pullRequest.summary, /Preview text wasn't provided/);
  assert.equal(commit.context, "OpenCoven/coven-cave · Commit 1234567");
});

test("citationSourcePresentation identifies research publications", () => {
  const arxiv = citationSourcePresentation({
    n: 1,
    id: "cite-1",
    title: "Attention Is All You Need",
    url: "https://arxiv.org/pdf/1706.03762",
    domain: "arxiv.org",
  });
  const doi = citationSourcePresentation({
    n: 2,
    id: "cite-2",
    title: "A journal article",
    url: "https://doi.org/10.1000/example",
    domain: "doi.org",
  });

  assert.deepEqual(
    [arxiv.kind, arxiv.provider, arxiv.context],
    ["arxiv", "arXiv", "Research paper · 1706.03762"],
  );
  assert.deepEqual(
    [doi.kind, doi.provider, doi.context],
    ["doi", "DOI", "Publication · 10.1000/example"],
  );
});

test("citationSourcePresentation tolerates malformed URL escapes", () => {
  const doi = citationSourcePresentation({
    n: 1,
    id: "cite-1",
    title: "Malformed DOI",
    url: "https://doi.org/10.1000/%E0%A4%A",
    domain: "doi.org",
  });
  const wikipedia = citationSourcePresentation({
    n: 2,
    id: "cite-2",
    title: "Malformed article",
    url: "https://en.wikipedia.org/wiki/%E0%A4%A",
    domain: "en.wikipedia.org",
  });

  assert.match(doi.context, /10\.1000\/%E0%A4%A/);
  assert.match(wikipedia.context, /%E0%A4%A/);
});

test("citationSourcePresentation provides distinct media and web fallbacks", () => {
  const cases = [
    ["https://en.wikipedia.org/wiki/Accessible_Rich_Internet_Applications", "wikipedia", "Wikipedia"],
    ["https://youtu.be/dQw4w9WgXcQ", "video", "YouTube"],
    ["https://example.com/report.pdf", "document", "PDF"],
    ["https://example.com/guide", "web", "example.com"],
  ] as const;

  for (const [url, kind, provider] of cases) {
    const presentation = citationSourcePresentation({
      n: 1,
      id: "cite-1",
      title: "Source title",
      url,
      domain: domainFromUrl(url),
    });
    assert.equal(presentation.kind, kind);
    assert.equal(presentation.provider, provider);
    assert.ok(presentation.summary.length > 0);
  }

  const local = citationSourcePresentation({
    n: 1,
    id: "cite-1",
    title: "Local design notes",
    snippet: "A project-local reference.",
  });
  assert.deepEqual(
    [local.kind, local.provider, local.context, local.summary],
    ["reference", "Reference", "Provided in this chat", "A project-local reference."],
  );
});

test("renderCitedBody rewrites inline refs to provider labels and passes plain text through", () => {
  const cited = renderCitedBody([
    "see [^a], [^b], and [^c]",
    "",
    '[^a]: https://github.com/OpenCoven/coven-cave/pull/4102 "Inline source previews"',
    '[^b]: https://arxiv.org/abs/1706.03762 "Attention Is All You Need"',
    '[^c]: https://example.com/guide "A web guide"',
  ].join("\n"));
  assert.match(cited.body, /see \[GitHub\]\(#cite-1\), \[arXiv\]\(#cite-2\), and \[example\.com\]\(#cite-3\)/);
  assert.doesNotMatch(cited.body, /\[\^a\]:/);
  assert.equal(cited.citations.length, 3);
  assert.equal(citationInlineLabel(cited.citations[0]), "GitHub");
  // Plain text (no footnotes) is returned verbatim.
  const plain = renderCitedBody("nothing to cite here");
  assert.deepEqual(plain, { body: "nothing to cite here", citations: [] });
});

test("renderCitationReferences enhances split chat spans using definitions from the full turn", () => {
  const parsed = parseCitations([
    "The paper introduced the architecture[^paper].",
    "",
    '[^paper]: https://arxiv.org/abs/1706.03762 "Attention Is All You Need"',
  ].join("\n"));

  assert.equal(
    renderCitationReferences("The paper introduced the architecture[^paper].", parsed),
    "The paper introduced the architecture[arXiv](#cite-1).",
  );
  assert.equal(
    renderCitationReferences('[^paper]: https://arxiv.org/abs/1706.03762 "Attention Is All You Need"', parsed),
    "",
  );
});

test("renderCitationReferences preserves trailing markdown whitespace in split chat spans", () => {
  const parsed = parseCitations([
    "The paper introduced the architecture[^paper].",
    "",
    '[^paper]: https://arxiv.org/abs/1706.03762 "Attention Is All You Need"',
  ].join("\n"));
  const segment = "The paper introduced the architecture[^paper].  \n\n\n";

  assert.equal(
    renderCitationReferences(segment, parsed),
    "The paper introduced the architecture[arXiv](#cite-1).  \n\n\n",
  );
});

test("parseCitations is a no-op without footnotes and ignores unreferenced defs", () => {
  const plain = "just a normal message with [a link](https://x.example).";
  assert.deepEqual(parseCitations(plain), { body: plain, citations: [], order: new Map() });
  // A definition with no inline reference is dropped (nothing points at it).
  const orphan = "text\n\n[^unused]: https://nowhere.example";
  assert.deepEqual(parseCitations(orphan).citations, []);
});

// ── Worktree citations (SourceCard.dc.html, repo variant) ────────────────────
//
// A familiar citing its own reading has no URL to open and no domain to name.
// `[^1]: src/lib/foo.ts#L12-L18 "why"` is the form it already writes, so the
// parser recognises it rather than degrading it to an unlinked "reference".

test("parseCitations reads a worktree file reference into a repo citation", () => {
  {
    const parsed = parseCitations(
      'Read it.[^1]\n\n[^1]: src/lib/citations.ts#L12-L18 "The parser" — the footnote reader\n',
    );
    assert.equal(parsed.citations.length, 1);
    const [citation] = parsed.citations;
    assert.deepEqual(citation.file, { path: "src/lib/citations.ts", lineStart: 12, lineEnd: 18 });
    assert.equal(citation.title, "The parser");
    assert.equal(citation.snippet, "the footnote reader");
    assert.equal(citation.url, undefined, "a worktree path is not a URL to open");
    assert.equal(citation.domain, undefined, "a worktree path has no domain");

    const presentation = citationSourcePresentation(citation);
    assert.equal(presentation.kind, "repo");
    assert.equal(presentation.provider, "This worktree");
    assert.equal(presentation.context, "src/lib/citations.ts · L12–18");
  }

  // The editor form and a single line both work; a bare path keeps no range.
  assert.deepEqual(parseCitationFileRef("apps/ios/CovenCave/App.swift:42-99"), {
    path: "apps/ios/CovenCave/App.swift",
    lineStart: 42,
    lineEnd: 99,
    title: undefined,
    snippet: undefined,
  });
  assert.equal(parseCitationFileRef("src/lib/x.ts#L7")?.lineStart, 7);
  assert.equal(parseCitationFileRef("src/lib/x.ts#L7")?.lineEnd, undefined);
  assert.equal(parseCitationFileRef("src/styles/globals.css")?.path, "src/styles/globals.css");
  assert.equal(lineRangeLabel({ path: "a/b.ts", lineStart: 5, lineEnd: 5 }), "L5", "a degenerate range reads as one line");
  assert.equal(lineRangeLabel({ path: "a/b.ts" }), undefined);

  // Prose must not be mistaken for a path — that would turn an ordinary note
  // into a file card pointing at nothing.
  assert.equal(parseCitationFileRef("Notes from the meeting on 4.5 things"), null);
  assert.equal(parseCitationFileRef("https://example.com/a/b.html"), null, "a URL stays a URL");
  assert.equal(parseCitationFileRef("justafile.ts"), null, "a bare filename with no directory is prose");

  // A URL definition still parses as a web source, unchanged.
  {
    const parsed = parseCitations('Cited.[^1]\n\n[^1]: <https://example.com/a> — a note\n');
    assert.equal(parsed.citations[0].file, undefined);
    assert.equal(parsed.citations[0].domain, "example.com");
  }
});
