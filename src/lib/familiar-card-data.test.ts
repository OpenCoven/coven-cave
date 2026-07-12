// @ts-nocheck
import assert from "node:assert/strict";
import { pickFamiliarMemory, memoryTitleAndExcerpt, formatRelTime, statusMeta } from "./familiar-card-data.ts";

// pickFamiliarMemory: filters by familiarId, sorts newest-first, limits, maps fields
const entries = [
  { familiarId: "cody", relPath: "memory/a.md", excerpt: "alpha", modified: "2026-06-10T00:00:00.000Z", fullPath: "/x/a.md" },
  { familiarId: "cody", relPath: "memory/b.md", excerpt: "bravo", modified: "2026-06-12T00:00:00.000Z", fullPath: "/x/b.md" },
  { familiarId: "salem", relPath: "memory/c.md", excerpt: "charlie", modified: "2026-06-13T00:00:00.000Z", fullPath: "/x/c.md" },
  { familiarId: "cody", relPath: "memory/d.md", excerpt: "delta", modified: "2026-06-11T00:00:00.000Z", fullPath: "/x/d.md" },
];
const picked = pickFamiliarMemory(entries, "cody", 2);
assert.equal(picked.length, 2, "limits to 2");
assert.equal(picked[0].title, "b.md", "newest first, basename title");
assert.equal(picked[0].excerpt, "bravo");
assert.equal(picked[1].title, "d.md", "second newest");
assert.ok(picked.every((p) => p.fullPath.startsWith("/x/")), "keeps fullPath");

// missing excerpt → empty string, never undefined
const noExcerpt = pickFamiliarMemory([{ familiarId: "cody", relPath: "m/e.md", modified: "2026-06-12T00:00:00.000Z", fullPath: "/x/e.md" }], "cody", 3);
assert.equal(noExcerpt[0].excerpt, "", "missing excerpt becomes empty string");

// entries without familiarId are excluded
assert.equal(pickFamiliarMemory([{ relPath: "m/f.md", modified: "2026-06-12T00:00:00.000Z", fullPath: "/x/f.md" }], "cody", 3).length, 0);

// memoryTitleAndExcerpt: heading runs become the human title, not raw markdown noise
{
  const r = memoryTitleAndExcerpt(
    "memory/2026-07-11.md",
    "# 2026-07-11\n\n## Coven memory layer sign-off\n\n- Sage handoff details",
  );
  assert.equal(r.title, "Coven memory layer sign-off", "deepest heading of the leading run is the title");
  assert.equal(r.excerpt, "Sage handoff details", "heading + list marker stripped from excerpt");
}
{
  const r = memoryTitleAndExcerpt("memory/notes.md", "plain text without headings\nmore");
  assert.equal(r.title, "notes.md", "no headings → basename");
  assert.equal(r.excerpt, "plain text without headings more", "lines joined for single-line display");
}
{
  const r = memoryTitleAndExcerpt("memory/empty.md", undefined);
  assert.equal(r.title, "empty.md");
  assert.equal(r.excerpt, "");
}
{
  const r = memoryTitleAndExcerpt("memory/multi.md", "# Title only");
  assert.equal(r.title, "Title only");
  assert.equal(r.excerpt, "", "nothing after the heading");
}

// stale flag: entries older than the growth threshold (21d) are badged
{
  const NOW = Date.parse("2026-07-12T00:00:00.000Z");
  const fresh = { familiarId: "cody", relPath: "m/fresh.md", excerpt: "x", modified: "2026-07-10T00:00:00.000Z", fullPath: "/x/fresh.md" };
  const old = { familiarId: "cody", relPath: "m/old.md", excerpt: "y", modified: "2026-06-01T00:00:00.000Z", fullPath: "/x/old.md" };
  const rows = pickFamiliarMemory([fresh, old], "cody", 3, NOW);
  assert.equal(rows[0].stale, false, "2d-old entry not stale");
  assert.equal(rows[1].stale, true, "41d-old entry stale");
}

// formatRelTime
assert.equal(formatRelTime(null), "never");
assert.equal(formatRelTime(new Date(Date.now() - 10_000).toISOString()), "just now");
assert.match(formatRelTime(new Date(Date.now() - 5 * 60_000).toISOString()), /^5m ago$/);
assert.match(formatRelTime(new Date(Date.now() - 3 * 3_600_000).toISOString()), /^3h ago$/);
assert.match(formatRelTime(new Date(Date.now() - 2 * 86_400_000).toISOString()), /^2d ago$/);
// Past a week, items show a real date (shared relativeTime), not an ever-growing "Nd ago".
assert.match(formatRelTime(new Date(Date.now() - 30 * 86_400_000).toISOString()), /^[A-Z][a-z]{2} \d{1,2}$/);

// statusMeta: known status → label + non-empty color; unknown → neutral, no pulse
const active = statusMeta("active");
assert.equal(active.label, "Active");
assert.equal(active.pulse, true);
assert.ok(active.color.length > 0);
const unknown = statusMeta("wat");
assert.equal(unknown.pulse, false);
assert.equal(unknown.label, "Unknown");

console.log("familiar-card-data.test.ts: ok");
