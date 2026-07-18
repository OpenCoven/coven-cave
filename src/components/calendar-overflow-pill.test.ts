// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Facelift cave-pmeh: the week grid used to give every concurrent event its
// own lane, so a cron fan-out (a dozen co-timed runs) rendered as unreadable
// sliver chips. These pin the capped-lane + "+N" rollup contract in TimeGrid.
const src = readFileSync(new URL("./calendar-view.tsx", import.meta.url), "utf8");

// ── Capped packing ───────────────────────────────────────────────────────────
assert.match(
  src,
  /packEventColumnsWithOverflow\(c\.items, maxLanes\)/,
  "TimeGrid packs with a lane cap (concurrent events beyond it roll up)",
);
assert.match(
  src,
  /maxLanes = WEEK_MAX_LANES/,
  "week view defaults to the week lane budget",
);
assert.match(
  src,
  /maxLanes=\{DAY_MAX_LANES\}/,
  "the wider single-day column passes the larger day budget",
);

// ── The "+N" pill ────────────────────────────────────────────────────────────
assert.match(
  src,
  /packedColumns\[ci\]\.overflows\.map/,
  "each cluster's rolled-up events render as a pill",
);
assert.match(src, /\+\{ov\.items\.length\}/, "pill shows how many events it holds");
assert.match(
  src,
  /aria-haspopup="menu"/,
  "pill is a disclosure button (menu semantics), not a dead label",
);
assert.match(
  src,
  /\$\{ov\.items\.length\} more events from/,
  "pill carries an accessible name with count and start time",
);
assert.match(
  src,
  /data-calendar-event="true"[\s\S]{0,40}aria-haspopup/,
  "pill participates in the grid's roving tabindex like event chips",
);

// ── The rollup popover ───────────────────────────────────────────────────────
assert.match(src, /<PopoverBody role="menu" ariaLabel="More events">/, "popover lists the hidden events as a menu");
assert.match(
  src,
  /onOpenItem\?\.\(item\);/,
  "selecting a listed event opens it like a regular chip click",
);

console.log("calendar-overflow-pill.test.ts: ok");
