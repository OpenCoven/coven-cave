// @ts-nocheck
import assert from "node:assert/strict";
import {
  taskAsanaLinkFromUrl,
  normalizeTaskAsanaLinks,
  mergeTaskAsanaLinks,
  mergeLinksWithAsana,
} from "./task-asana.ts";

// ── URL parsing across the layouts Asana has shipped ─────────────────────────

// classic /0/<project>/<task>
let l = taskAsanaLinkFromUrl("https://app.asana.com/0/1200000000000001/1200000000000002");
assert.ok(l, "classic project→task URL parses");
assert.equal(l.kind, "task");
assert.equal(l.gid, "1200000000000002");
assert.equal(l.projectGid, "1200000000000001");
assert.equal(l.source, "legacy-link");

// focus view /0/<project>/<task>/f
l = taskAsanaLinkFromUrl("https://app.asana.com/0/1111111111/2222222222/f");
assert.equal(l.gid, "2222222222", "focus-view suffix ignored");

// my-tasks permalink /0/0/<task>/f — project sentinel 0 is not a real project
l = taskAsanaLinkFromUrl("https://app.asana.com/0/0/3333333333/f");
assert.equal(l.gid, "3333333333");
assert.equal(l.projectGid, undefined, "0 sentinel is not treated as a project");

// newer grid layout /1/<ws>/project/<p>/task/<t>
l = taskAsanaLinkFromUrl("https://app.asana.com/1/9999/project/4444/task/5555");
assert.equal(l.gid, "5555");
assert.equal(l.projectGid, "4444");

// project-only /0/<project>
l = taskAsanaLinkFromUrl("https://app.asana.com/0/6666666666");
assert.equal(l.kind, "project");
assert.equal(l.gid, "6666666666");

// non-Asana host → null
assert.equal(taskAsanaLinkFromUrl("https://github.com/o/r/issues/1"), null);
// inbox with no gid → null
assert.equal(taskAsanaLinkFromUrl("https://app.asana.com/0/inbox"), null);
assert.equal(taskAsanaLinkFromUrl("not a url"), null);

// ── merge / dedupe by gid across URL variants ────────────────────────────────
const a = taskAsanaLinkFromUrl("https://app.asana.com/0/1000000000000010/1000000000000020");
const b = taskAsanaLinkFromUrl("https://app.asana.com/0/0/1000000000000020/f");
const merged = mergeTaskAsanaLinks([a], b);
assert.equal(merged.length, 1, "same gid dedupes regardless of URL layout");

// a concrete assigned source beats a legacy-link guess, and its title wins
const assigned = { ...a, source: "assigned", title: "Real title" };
const m2 = mergeTaskAsanaLinks([a], assigned);
assert.equal(m2.length, 1);
assert.equal(m2[0].source, "assigned");
assert.equal(m2[0].title, "Real title");

// ── normalize keeps only recognizable Asana URLs ─────────────────────────────
const norm = normalizeTaskAsanaLinks([
  { url: "https://app.asana.com/0/1000000000000001/1000000000000002" },
  { url: "not a url" },
  { url: "https://github.com/x/y" },
]);
assert.equal(norm.length, 1, "junk + non-Asana URLs are dropped");
assert.equal(norm[0].gid, "1000000000000002");

// ── links union ──────────────────────────────────────────────────────────────
// Membership via a Set (exact equality) rather than String#includes so the
// assertion can't be misread as URL substring sanitization (CodeQL
// js/incomplete-url-substring-sanitization).
const other = "https://example.test/board";
const linkSet = new Set(mergeLinksWithAsana([other], [a]));
assert.ok(linkSet.has(other), "existing links are preserved");
assert.ok(linkSet.has(a.url), "asana link URL is folded into links");

console.log("task-asana passed");
