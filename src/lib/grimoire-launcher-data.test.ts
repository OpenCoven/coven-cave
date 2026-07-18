import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLauncherItems,
  detectLauncherCapture,
  journalStreakDays,
  launcherExcerpt,
  launcherGraphCounts,
  launcherWeekStats,
  memoryMarker,
  searchLauncherItems,
  topMemoryRoot,
} from "./grimoire-launcher-data.ts";
import type { DocGraph } from "./grimoire-graph.ts";

const NOW = Date.parse("2026-07-18T12:00:00");
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString();

function pool() {
  return buildLauncherItems({
    knowledge: [
      { id: "release-checklist", title: "Release checklist", tags: ["release"], modified: iso(0.1) },
      { id: "old-notes", title: "Old notes", tags: [] },
    ],
    memory: [
      { relPath: "coven/MEMORY.md", fullPath: "/m/MEMORY.md", modified: iso(2), rootLabel: "Coven memory" },
      { relPath: "runtime/2026-07-01.md", fullPath: "/m/r/2026-07-01.md", modified: iso(10), rootLabel: "OpenClaw runtime" },
      { relPath: "runtime/2026-07-02.md", fullPath: "/m/r/2026-07-02.md", modified: iso(9), rootLabel: "OpenClaw runtime" },
    ],
    journal: [
      { date: "2026-07-17", preview: "Shipped the launcher.", modified: iso(1) },
      { date: "2026-06-01", preview: "Long ago.", modified: null },
    ],
  });
}

test("buildLauncherItems merges corpora newest-first, undated last", () => {
  const items = pool();
  assert.equal(items[0].title, "Release checklist");
  assert.equal(items[0].kindLabel, "Stitch");
  assert.equal(items[1].ref.kind, "journal");
  // Undated knowledge sinks to the end.
  assert.equal(items[items.length - 1].title, "Old notes");
  assert.equal(items[items.length - 1].modifiedMs, null);
});

test("markers follow the prototype type language", () => {
  const items = pool();
  const byTitle = (t: string) => items.find((i) => i.title === t)!;
  assert.equal(byTitle("Release checklist").marker, "ring-dashed");
  assert.equal(byTitle("MEMORY.md").marker, "diamond");
  assert.equal(byTitle("2026-07-01.md").marker, "dot");
  assert.equal(byTitle("2026-07-17").marker, "ring-open");
  assert.equal(memoryMarker("deep/dir/AGENTS.md"), "diamond");
  assert.equal(memoryMarker("deep/dir/scratch.md"), "dot");
});

test("searchLauncherItems matches every token across title/tags/kind", () => {
  const items = pool();
  assert.equal(searchLauncherItems(items, "release check")[0].title, "Release checklist");
  // Kind words match too.
  assert.ok(searchLauncherItems(items, "journal").every((i) => i.kindLabel === "Journal"));
  assert.equal(searchLauncherItems(items, "").length, 0);
  assert.equal(searchLauncherItems(items, "zzz-nothing").length, 0);
  assert.equal(searchLauncherItems(items, "m", 2).length, 2, "limit caps results");
});

test("launcherWeekStats counts trailing-7-day touches and reflections", () => {
  const items = pool();
  const stats = launcherWeekStats(
    items,
    [
      { date: "2026-07-17", preview: "", modified: null },
      { date: "2026-06-01", preview: "", modified: null },
    ],
    NOW,
  );
  // Release checklist (0.1d), MEMORY.md (2d), journal 2026-07-17 (1d) — the
  // runtime files (9-10d) and June journal fall outside the window.
  assert.equal(stats.filesTouched, 3);
  assert.equal(stats.reflections, 1);
});

test("launcherWeekStats caps the window at end-of-today (no future inflation)", () => {
  const dayMs = 24 * 60 * 60 * 1000;
  const futureItem = buildLauncherItems({
    knowledge: [
      { id: "skewed", title: "Skewed clock", tags: [], modified: new Date(NOW + 2 * dayMs).toISOString() },
      { id: "fresh", title: "Fresh", tags: [], modified: new Date(NOW - dayMs).toISOString() },
    ],
    memory: [],
    journal: [],
  });
  const stats = launcherWeekStats(
    futureItem,
    [
      { date: "2026-07-18", preview: "", modified: null }, // today, noon anchor — counts even in the morning
      { date: "2026-07-19", preview: "", modified: null }, // tomorrow — never counts
    ],
    Date.parse("2026-07-18T09:00:00"),
  );
  assert.equal(stats.filesTouched, 1, "future mtimes (clock skew) are excluded");
  assert.equal(stats.reflections, 1, "today counts, future-dated entries do not");
});

test("journalStreakDays counts back from today, tolerating an unwritten today", () => {
  assert.equal(journalStreakDays(["2026-07-18", "2026-07-17", "2026-07-16"], "2026-07-18"), 3);
  // Today not yet written — streak anchors on yesterday.
  assert.equal(journalStreakDays(["2026-07-17", "2026-07-16"], "2026-07-18"), 2);
  // A gap breaks the streak.
  assert.equal(journalStreakDays(["2026-07-18", "2026-07-16"], "2026-07-18"), 1);
  assert.equal(journalStreakDays(["2026-07-10"], "2026-07-18"), 0);
  assert.equal(journalStreakDays([], "2026-07-18"), 0);
});

test("launcherGraphCounts counts doc nodes, edges, and detached docs (tags excluded)", () => {
  const graph: DocGraph = {
    nodes: [
      { id: "a", ref: { kind: "knowledge", id: "a" }, kind: "knowledge", title: "A", degree: 1 },
      { id: "b", ref: { kind: "knowledge", id: "b" }, kind: "knowledge", title: "B", degree: 0 },
      { id: "t", ref: null, kind: "tag", title: "#t", degree: 1 },
    ],
    edges: [{ id: "e1", source: "a", target: "t", type: "tag" }],
  };
  assert.deepEqual(launcherGraphCounts(graph), { nodes: 2, edges: 1, detached: 1 });
  assert.deepEqual(launcherGraphCounts(null), { nodes: 0, edges: 0, detached: 0 });
});

test("topMemoryRoot picks the largest root", () => {
  assert.deepEqual(
    topMemoryRoot([
      { relPath: "a", fullPath: "a", modified: iso(1), rootLabel: "OpenClaw runtime" },
      { relPath: "b", fullPath: "b", modified: iso(1), rootLabel: "OpenClaw runtime" },
      { relPath: "c", fullPath: "c", modified: iso(1), rootLabel: "Coven memory" },
    ]),
    { label: "OpenClaw runtime", count: 2 },
  );
  assert.equal(topMemoryRoot([]), null);
});

test("detectLauncherCapture recognizes github repos, llms.txt, and plain pages", () => {
  assert.equal(detectLauncherCapture("release notes"), null);
  assert.equal(detectLauncherCapture("https://"), null);
  assert.equal(detectLauncherCapture("http://localhost"), null, "hostname must be dotted");
  const gh = detectLauncherCapture("https://github.com/OpenCoven/coven-cave");
  assert.equal(gh?.flavor, "github");
  assert.match(gh!.label, /repo/i);
  // github.com root (no owner/repo) is just a page.
  assert.equal(detectLauncherCapture("https://github.com")?.flavor, "page");
  const llms = detectLauncherCapture("https://docs.example.com/llms.txt");
  assert.equal(llms?.flavor, "llms");
  const llmsFull = detectLauncherCapture("https://docs.example.com/llms-full.txt");
  assert.equal(llmsFull?.flavor, "llms");
  const page = detectLauncherCapture("www.example.com/blog/post");
  assert.equal(page?.flavor, "page");
  assert.equal(page?.url, "https://www.example.com/blog/post", "www.-prefixed input normalizes to https");
  assert.equal(detectLauncherCapture("https://example.com/a b"), null, "spaces are not URLs");
});

test("launcherExcerpt strips markdown and clamps on a word edge", () => {
  assert.equal(launcherExcerpt(undefined), undefined);
  assert.equal(launcherExcerpt("   "), undefined);
  assert.equal(
    launcherExcerpt("## Heading\n\nCoven Cave is the *desktop* control room for [OpenCoven](https://x.y) familiars."),
    "Coven Cave is the desktop control room for OpenCoven familiars.",
  );
  assert.equal(launcherExcerpt("```js\ncode only\n```"), undefined, "fenced code never leaks");
  assert.equal(launcherExcerpt("See [[docs/setup|the setup guide]] first."), "See the setup guide first.");
  const long = launcherExcerpt(`${"word ".repeat(60)}end`);
  assert.ok(long!.length <= 201, "clamped");
  assert.ok(long!.endsWith("…"), "ellipsis on clamp");
  // knowledge bodies flow into hero items
  const items = buildLauncherItems({
    knowledge: [{ id: "a", title: "A", tags: [], body: "# T\n\nBody text here.", modified: iso(1) }],
    memory: [],
    journal: [],
  });
  assert.equal(items[0].excerpt, "Body text here.");
});
