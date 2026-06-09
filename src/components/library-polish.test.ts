// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bookmarks = await readFile(new URL("./library-bookmarks-list.tsx", import.meta.url), "utf8");
const reading   = await readFile(new URL("./library-reading-list.tsx",   import.meta.url), "utf8");
const github    = await readFile(new URL("./library-github-list.tsx",    import.meta.url), "utf8");

// ───────── Task 1: localeCompare null-guards ─────────
// bookmarks — title, domain, savedAt
assert.match(bookmarks, /\(a\.title \?\? ""\)\.localeCompare\(b\.title \?\? ""\)/,    "bookmarks title null-guard");
assert.match(bookmarks, /\(a\.domain \?\? ""\)\.localeCompare\(b\.domain \?\? ""\)/,  "bookmarks domain null-guard");
assert.match(bookmarks, /\(a\.savedAt \?\? ""\)\.localeCompare\(b\.savedAt \?\? ""\)/,"bookmarks savedAt null-guard");

// reading — title, addedAt, label
assert.match(reading, /\(a\.title \?\? ""\)\.localeCompare\(b\.title \?\? ""\)/,     "reading title null-guard");
assert.match(reading, /\(a\.addedAt \?\? ""\)\.localeCompare\(b\.addedAt \?\? ""\)/, "reading addedAt null-guard");
assert.match(reading, /\(a\.label \?\? ""\)\.localeCompare\(b\.label \?\? ""\)/,     "reading label null-guard");

// github — title, repo, savedAt
assert.match(github, /\(a\.title \?\? ""\)\.localeCompare\(b\.title \?\? ""\)/,   "github title null-guard");
assert.match(github, /\(a\.repo \?\? ""\)\.localeCompare\(b\.repo \?\? ""\)/,     "github repo null-guard");
assert.match(github, /\(a\.savedAt \?\? ""\)\.localeCompare\(b\.savedAt \?\? ""\)/,"github savedAt null-guard");

// ───────── Task 2: Timeline placeholder shortened ─────────
const timeline = await readFile(new URL("./library-timeline.tsx", import.meta.url), "utf8");
assert.match(timeline, /placeholder="Search links…"/, "Timeline placeholder must be 'Search links…'");
assert.match(timeline, /title="Search links — try chat: github: sage:"/, "Verbose hint must live in title=");
assert.doesNotMatch(timeline, /placeholder="Search links — try chat: github: sage:"/, "Old long placeholder must be removed");

console.log("library-polish.test.ts: ok");
