import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  categorizeLink,
  deriveLinkTitle,
  groupSavedLinks,
  LINK_CATEGORY_META,
  LINK_CATEGORY_ORDER,
  normalizeLinkUrl,
  type SavedLink,
} from "./link-organizer.ts";

// ── categorization ────────────────────────────────────────────────────────────

test("categorizeLink recognizes work-relevant hosts and path shapes", () => {
  assert.equal(categorizeLink("https://github.com/OpenCoven/coven-cave/pull/3211"), "github");
  assert.equal(categorizeLink("https://gist.github.com/someone/abc123"), "github");
  assert.equal(categorizeLink("https://arxiv.org/abs/2404.12345"), "paper");
  assert.equal(categorizeLink("https://doi.org/10.1145/3576915"), "paper");
  assert.equal(categorizeLink("https://www.youtube.com/watch?v=abc"), "video");
  assert.equal(categorizeLink("https://youtu.be/abc"), "video");
  assert.equal(categorizeLink("https://news.ycombinator.com/item?id=1"), "social");
  assert.equal(categorizeLink("https://x.com/someone/status/1"), "social");
  assert.equal(categorizeLink("https://docs.rs/tokio/latest"), "docs");
  assert.equal(categorizeLink("https://react.dev/reference/react"), "docs");
  assert.equal(categorizeLink("https://example.com/blog/how-we-ship"), "article");
  assert.equal(categorizeLink("https://medium.com/@a/why-things"), "article");
  assert.equal(categorizeLink("https://example.com"), "other");
  assert.equal(categorizeLink("not a url"), "other");
});

// ── title derivation (no network) ─────────────────────────────────────────────

test("deriveLinkTitle humanizes the URL without fetching", () => {
  assert.equal(deriveLinkTitle("https://github.com/OpenCoven/coven-cave"), "OpenCoven/coven-cave");
  assert.equal(
    deriveLinkTitle("https://github.com/OpenCoven/coven-cave/pull/3211"),
    "OpenCoven/coven-cave #3211",
  );
  assert.equal(
    deriveLinkTitle("https://example.com/blog/how-we-ship-fast.html"),
    "how we ship fast · example.com",
  );
  assert.equal(deriveLinkTitle("https://example.com"), "example.com");
  // Id-shaped tails fall back to the wordy segment before them.
  assert.equal(
    deriveLinkTitle("https://example.com/posts/2024/01/12345"),
    "posts · example.com",
  );
});

// ── dedupe normalization ──────────────────────────────────────────────────────

test("normalizeLinkUrl produces one key per page", () => {
  assert.equal(
    normalizeLinkUrl("https://Example.com/Post/"),
    normalizeLinkUrl("https://example.com/Post"),
  );
  assert.equal(
    normalizeLinkUrl("https://example.com/a#section"),
    normalizeLinkUrl("https://example.com/a"),
  );
  assert.notEqual(
    normalizeLinkUrl("https://example.com/a?q=1"),
    normalizeLinkUrl("https://example.com/a"),
    "query strings stay significant",
  );
});

// ── grouping ──────────────────────────────────────────────────────────────────

test("groupSavedLinks orders shelves by category and omits empty groups", () => {
  const link = (url: string, addedAt: string): SavedLink => ({
    id: url,
    url,
    category: categorizeLink(url),
    title: deriveLinkTitle(url),
    addedAt,
    source: "desk",
  });
  const groups = groupSavedLinks([
    link("https://example.com/blog/a", "2026-07-15T01:00:00Z"),
    link("https://github.com/a/b", "2026-07-15T02:00:00Z"),
    link("https://github.com/c/d", "2026-07-15T03:00:00Z"),
  ]);
  assert.deepEqual(groups.map((g) => g.category), ["github", "article"]);
  assert.equal(groups[0].links.length, 2);
  assert.equal(groups[0].label, LINK_CATEGORY_META.github.label);
  // Every category has display metadata and a place in the order.
  for (const category of LINK_CATEGORY_ORDER) {
    assert.ok(LINK_CATEGORY_META[category].label);
    assert.ok(LINK_CATEGORY_META[category].icon.startsWith("ph:"));
  }
});

// ── wiring pins ───────────────────────────────────────────────────────────────

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

test("/save (alias /link) is a first-class slash command", () => {
  const registry = readFileSync(path.join(repoRoot, "src/lib/slash-commands.ts"), "utf8");
  assert.match(registry, /name: "\/save", aliases: \["\/link"\]/);

  const chat = readFileSync(path.join(repoRoot, "src/components/chat-view.tsx"), "utf8");
  assert.match(chat, /command === "\/save"/, "the composer handles the canonical command");
  assert.match(
    chat,
    /command === "\/save"[\s\S]{0,400}extractLinks\(args\)/,
    "the handler extracts every http(s) link from the arguments",
  );
  assert.match(
    chat,
    /fetch\("\/api\/research\/links", \{\s*method: "POST"/,
    "saves flow through the research links API",
  );
});

test("the Research desk mounts the Links shelf over the same store", () => {
  const surface = readFileSync(
    path.join(repoRoot, "src/components/role-surfaces/researcher-surface.tsx"),
    "utf8",
  );
  assert.match(surface, /<ResearchLinkShelf onOpenUrl=\{context\.openUrl\} \/>/);

  const shelf = readFileSync(
    path.join(repoRoot, "src/components/role-surfaces/research-link-shelf.tsx"),
    "utf8",
  );
  assert.match(shelf, /extractLinks\(draft\)/, "the shelf accepts one or many pasted links");
  assert.match(shelf, /groupSavedLinks\(links\)/, "the shelf renders auto-organized groups");
  assert.match(shelf, /source: "desk"/, "desk saves are attributed");
});
