import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  categorizeLink,
  deriveLinkTitle,
  groupSavedLinksByUsage,
  LINK_CATEGORY_META,
  linkCategoryMeta,
  LINK_CATEGORY_ORDER,
  MAX_LINKS_PER_SAVE,
  normalizeLinkUrl,
  summarizeLinkIntake,
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
  // Trailing slash must vanish even with a query string after it, and
  // doubled separators must collapse (review finding on 972bf1cd).
  assert.equal(
    normalizeLinkUrl("https://example.com/blog/?p=1"),
    normalizeLinkUrl("https://example.com/blog?p=1"),
  );
  assert.equal(
    normalizeLinkUrl("https://example.com/path//"),
    normalizeLinkUrl("https://example.com/path"),
  );
  assert.notEqual(
    normalizeLinkUrl("https://example.com/a?q=1"),
    normalizeLinkUrl("https://example.com/a"),
    "query strings stay significant",
  );
});

// ── intake preview ────────────────────────────────────────────────────────────

test("summarizeLinkIntake previews unique ready and already-saved resources", () => {
  const saved: SavedLink[] = [{
    id: "saved",
    url: "https://example.com/post",
    category: "other",
    title: "Saved",
    addedAt: "2026-07-26T00:00:00Z",
    source: "desk",
  }];

  const summary = summarizeLinkIntake(
    [
      "https://github.com/OpenCoven/coven-cave,https://arxiv.org/abs/2404.12345",
      "https://example.com/post#section",
      "https://example.com/post/",
    ].join("\n"),
    saved,
  );

  assert.equal(summary.detectedCount, 4);
  assert.deepEqual(
    summary.ready.map((item) => item.category),
    ["github", "paper"],
  );
  assert.deepEqual(
    summary.duplicates.map((item) => item.url),
    ["https://example.com/post#section"],
  );
  assert.deepEqual(summary.categoryCounts, { github: 1, paper: 1, article: 1 });
  assert.equal(summary.overLimit, false);
  assert.equal(summary.canSubmit, true);
});

test("summarizeLinkIntake exposes the shared save limit", () => {
  const text = Array.from(
    { length: MAX_LINKS_PER_SAVE + 1 },
    (_, index) => `https://bulk.example.com/${index}`,
  ).join("\n");
  const summary = summarizeLinkIntake(text, []);
  assert.equal(summary.detectedCount, MAX_LINKS_PER_SAVE + 1);
  assert.equal(summary.overLimit, true);
  assert.equal(summary.canSubmit, false);
});

// ── workflow grouping ─────────────────────────────────────────────────────────

const savedLink = (id: string, url: string): SavedLink => ({
  id,
  url,
  category: categorizeLink(url),
  title: deriveLinkTitle(url),
  addedAt: "2026-07-26T00:00:00Z",
  source: "desk",
});

test("groupSavedLinksByUsage prioritizes selected, uncited, and other-run links", () => {
  const selected = savedLink("selected", "https://example.com/selected");
  const uncited = savedLink("uncited", "https://example.com/uncited");
  const other = savedLink("other", "https://example.com/other");
  const citedBy = new Map<string, { id: string }[]>([
    [normalizeLinkUrl(selected.url), [{ id: "mission-selected" }]],
    [normalizeLinkUrl(other.url), [{ id: "mission-other" }]],
  ]);

  const groups = groupSavedLinksByUsage(
    [selected, uncited, other],
    citedBy,
    "mission-selected",
  );

  assert.deepEqual(groups.map((group) => group.id), ["selected", "uncited", "cited"]);
  assert.deepEqual(groups.map((group) => group.label), [
    "In this run",
    "Uncited",
    "Used in other runs",
  ]);
  assert.deepEqual(groups.map((group) => group.links.map((link) => link.id)), [
    ["selected"],
    ["uncited"],
    ["other"],
  ]);
});

test("groupSavedLinksByUsage omits selected grouping without a selected mission", () => {
  const uncited = savedLink("uncited", "https://example.com/uncited");
  const cited = savedLink("cited", "https://example.com/cited");
  const citedBy = new Map<string, { id: string }[]>([
    [normalizeLinkUrl(cited.url), [{ id: "mission-one" }]],
  ]);

  const groups = groupSavedLinksByUsage([uncited, cited], citedBy);
  assert.deepEqual(groups.map((group) => group.id), ["uncited", "cited"]);
  assert.deepEqual(groups.map((group) => group.label), ["Uncited", "Used in runs"]);
  // Every category keeps display metadata for intake/category filters.
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

test("the Research desk consumes the same links store", () => {
  // The old collapsible shelf became two consumers of one shared hook: the
  // Prompt tab's quick saves and the Resources tab's browser (cave-dl74).
  const hook = readFileSync(
    path.join(repoRoot, "src/components/role-surfaces/use-research-links.ts"),
    "utf8",
  );
  assert.match(hook, /fetch\("\/api\/research\/links"/, "the hook is the one client for the store");
  assert.match(hook, /source: "desk"/, "desk saves are attributed");

  const resources = readFileSync(
    path.join(repoRoot, "src/components/role-surfaces/research-tab-resources.tsx"),
    "utf8",
  );
  assert.match(resources, /useResearchLinks/, "Resources reads through the shared hook");
  assert.match(
    resources,
    /groupSavedLinksByUsage\(/,
    "Resources renders workflow-first organized groups",
  );

  const prompt = readFileSync(
    path.join(repoRoot, "src/components/role-surfaces/research-tab-prompt.tsx"),
    "utf8",
  );
  assert.match(prompt, /useResearchLinks/, "quick saves read the same store");
});

test("unknown categories degrade to Other instead of crashing a surface", () => {
  // The store is shared across app versions — a category this build doesn't
  // know must never take down the Research Desk (it did once: reading .icon
  // off an undefined meta unloaded the whole surface).
  const foreign = {
    id: "x1",
    url: "https://example.com/x",
    category: "newsletter" as never,
    title: "Foreign category",
    addedAt: new Date().toISOString(),
    source: "chat" as const,
  };
  assert.equal(linkCategoryMeta("newsletter").label, "Other");
  const groups = groupSavedLinksByUsage([foreign], new Map());
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, "uncited");
  // Surfaces go through the tolerant accessor, not raw table indexing.
  for (const rel of [
    "src/components/role-surfaces/research-tab-resources.tsx",
    "src/components/role-surfaces/research-tab-prompt.tsx",
  ]) {
    const source = readFileSync(path.join(repoRoot, rel), "utf8");
    assert.match(source, /linkCategoryMeta\(/);
    assert.doesNotMatch(source, /LINK_CATEGORY_META\[/);
  }
});

test("huggingface.co/papers is a paper, other HF paths are not", () => {
  assert.equal(categorizeLink("https://huggingface.co/papers/2401.12345"), "paper");
  assert.equal(categorizeLink("https://huggingface.co/papers"), "paper");
  assert.equal(categorizeLink("https://huggingface.co/papers/"), "paper");
  assert.notEqual(categorizeLink("https://huggingface.co/models/meta-llama/Llama-3"), "paper");
  assert.notEqual(categorizeLink("https://huggingface.co/datasets/squad"), "paper");
  assert.notEqual(categorizeLink("https://huggingface.co/blog/some-post"), "paper");
});
