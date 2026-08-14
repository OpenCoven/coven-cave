// Contract tests for the assigned-work completeness model (cave-amx2m): caps,
// partial failures, and the disclosure line the task picker renders. Plus
// source pins for how the route and BoardInspector consume it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import {
  assignedDisclosure,
  failedSource,
  isPartial,
  isTruncated,
  restSource,
  searchSource,
  type AssignedSourcesMeta,
} from "./github-assigned-meta.ts";

const full = (over: Partial<AssignedSourcesMeta> = {}): AssignedSourcesMeta => ({
  assigned: { ok: true, truncated: false, count: 3 },
  reviewRequested: { ok: true, truncated: false, count: 2, total: 2 },
  authored: { ok: true, truncated: false, count: 1, total: 1 },
  ...over,
});

test("REST caps: a rel=next Link header flags truncation, and so does a full page without one", () => {
  assert.equal(restSource(12, 50, null).truncated, false, "under the cap, no next page — complete");
  assert.equal(restSource(12, 50, '<https://api.github.com/issues?page=2>; rel="next"').truncated, true, "next page exists");
  // A page exactly at the cap is indistinguishable from overflow — "maybe
  // more" must never render as "that's everything".
  assert.equal(restSource(50, 50, null).truncated, true, "full page counts as truncated even without the header");
});

test("search caps: total_count makes truncation exact and never undercounts", () => {
  assert.deepEqual(searchSource(30, 84), { ok: true, truncated: true, count: 30, total: 84 });
  assert.deepEqual(searchSource(7, 7), { ok: true, truncated: false, count: 7, total: 7 });
  // A total below the returned count would be a lie — clamp up, never down.
  assert.equal(searchSource(30, 4).total, 30);
  assert.equal(searchSource(5, undefined).truncated, false, "no total → no truncation claim");
});

test("partial failures: one dead source marks the aggregate partial, not empty", () => {
  const sources = full({ reviewRequested: failedSource("GitHub API error: HTTP 502") });
  assert.equal(isPartial(sources), true);
  assert.equal(isTruncated(sources), false);
  assert.match(
    assignedDisclosure(sources, 4) ?? "",
    /1 GitHub source didn't load — this list may be incomplete\./,
  );
});

test("failure outranks truncation in the disclosure line", () => {
  const sources = full({
    assigned: { ok: true, truncated: true, count: 50 },
    authored: failedSource("boom"),
  });
  assert.match(assignedDisclosure(sources, 52) ?? "", /didn't load/);
});

test("pure truncation discloses the window; complete responses disclose nothing", () => {
  const capped = full({
    reviewRequested: { ok: true, truncated: true, count: 30, total: 84 },
    authored: { ok: true, truncated: true, count: 30, total: 41 },
  });
  assert.equal(isTruncated(capped), true);
  assert.match(assignedDisclosure(capped, 63) ?? "", /Showing the newest 63/);
  // A REST cap has no total — the line stays honest about not knowing.
  const restCapped = full({ assigned: { ok: true, truncated: true, count: 50 } });
  assert.match(assignedDisclosure(restCapped, 53) ?? "", /more exists on GitHub than fits here/);
  assert.equal(assignedDisclosure(full(), 6), null, "a complete list needs no caveat");
});

// ── Wiring pins ──────────────────────────────────────────────────────────────

const route = readFileSync(new URL("../app/api/github/assigned/route.ts", import.meta.url), "utf8");
const inspector = readFileSync(new URL("../components/board-inspector.tsx", import.meta.url), "utf8");

test("the route fetches each capped source fault-isolated and returns the metadata", () => {
  assert.match(route, /async function fetchSource</, "sources fetch through the fault-isolated helper");
  assert.match(
    route,
    /if \(!assigned\.meta\.ok && !review\.meta\.ok && !created\.meta\.ok\)/,
    "only ALL sources failing produces an error response",
  );
  assert.match(route, /sources,\s*\n\s*partial: isPartial\(sources\),\s*\n\s*truncated: isTruncated\(sources\),/, "the success payload carries per-source metadata");
  assert.match(route, /restSource\(items\.length, ASSIGNED_PER_PAGE, linkHeader\)/, "the REST cap is measured");
  assert.match(route, /searchSource\(items\.length, body\?\.total_count\)/, "search caps use GitHub's own totals");
  assert.match(
    route,
    /assigned\.unauthorized \|\| review\.unauthorized \|\| created\.unauthorized/,
    "a 401 anywhere still routes to the patInvalid response, not a partial list",
  );
});

test("BoardInspector never renders a capped or half-loaded list as a trustworthy empty", () => {
  assert.match(
    inspector,
    /partial\s*\n?\s*\? "Couldn’t load all GitHub sources — there may be work this list can’t see\."\s*\n?\s*: "No open issues, PRs, or review requests assigned to you\."/,
    "the definitive empty claim is earned only by a complete response",
  );
  assert.match(
    inspector,
    /\{disclosure \? `No matches in what loaded — \$\{disclosure\}` : "No matches\."\}/,
    "filtered emptiness discloses the window it searched",
  );
  assert.match(
    inspector,
    /filtered\.length > 0 && disclosure &&/,
    "a non-empty but incomplete list carries the completeness footer",
  );
  assert.match(
    inspector,
    /assignedDisclosure\(d\.sources, \(d\.items \?\? \[\]\)\.length\)/,
    "the disclosure line derives from the endpoint's own metadata",
  );
});
