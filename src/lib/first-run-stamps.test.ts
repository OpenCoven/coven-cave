// @ts-nocheck
// cave-fy1q phase 3 — first-run funnel stamps: measurement only. Pure tests
// exercise the injectable store; source pins hold the three wiring points
// (workspace anchor, chat-view reply stamp, analytics surfacing).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FIRST_OPEN_AT_KEY,
  FIRST_REPLY_AT_KEY,
  stampFirstOpenOnce,
  stampFirstReplyOnce,
  timeToFirstReplyMs,
  formatTimeToFirstReply,
} from "./first-run-stamps.ts";

function fakeStore(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    map: m,
  };
}

// ── stampFirstOpenOnce ────────────────────────────────────────────────────────
{
  const s = fakeStore();
  stampFirstOpenOnce(s, new Date("2026-07-09T10:00:00Z"));
  assert.equal(s.map.get(FIRST_OPEN_AT_KEY), "2026-07-09T10:00:00.000Z", "stamps a fresh install");
  stampFirstOpenOnce(s, new Date("2026-07-09T11:00:00Z"));
  assert.equal(s.map.get(FIRST_OPEN_AT_KEY), "2026-07-09T10:00:00.000Z", "written once, ever");
}
{
  const s = fakeStore({ "cave:onboarding:dismissed": "1" });
  stampFirstOpenOnce(s, new Date());
  assert.equal(s.map.has(FIRST_OPEN_AT_KEY), false, "existing installs (onboarding dismissed) never re-anchor");
}

// ── stampFirstReplyOnce ───────────────────────────────────────────────────────
{
  const s = fakeStore();
  stampFirstReplyOnce(s, new Date("2026-07-09T10:05:00Z"));
  assert.equal(s.map.has(FIRST_REPLY_AT_KEY), false, "no anchor → no reply stamp (pre-existing installs)");
  s.setItem(FIRST_OPEN_AT_KEY, "2026-07-09T10:00:00.000Z");
  stampFirstReplyOnce(s, new Date("2026-07-09T10:05:00Z"));
  assert.equal(s.map.get(FIRST_REPLY_AT_KEY), "2026-07-09T10:05:00.000Z", "stamps once the anchor exists");
  stampFirstReplyOnce(s, new Date("2026-07-09T12:00:00Z"));
  assert.equal(s.map.get(FIRST_REPLY_AT_KEY), "2026-07-09T10:05:00.000Z", "first reply is immutable");
}

// ── timeToFirstReplyMs ────────────────────────────────────────────────────────
assert.equal(timeToFirstReplyMs(fakeStore()), null, "no stamps → null");
assert.equal(
  timeToFirstReplyMs(fakeStore({ [FIRST_OPEN_AT_KEY]: "2026-07-09T10:00:00.000Z" })),
  null,
  "anchor only → null",
);
assert.equal(
  timeToFirstReplyMs(
    fakeStore({
      [FIRST_OPEN_AT_KEY]: "2026-07-09T10:00:00.000Z",
      [FIRST_REPLY_AT_KEY]: "2026-07-09T10:07:30.000Z",
    }),
  ),
  450_000,
  "delta in ms",
);
assert.equal(
  timeToFirstReplyMs(
    fakeStore({
      [FIRST_OPEN_AT_KEY]: "2026-07-09T10:00:00.000Z",
      [FIRST_REPLY_AT_KEY]: "2026-07-09T09:00:00.000Z",
    }),
  ),
  null,
  "clock-skewed negative delta → null, never a lie",
);

// ── formatTimeToFirstReply ────────────────────────────────────────────────────
assert.equal(formatTimeToFirstReply(42_000), "42s");
assert.equal(formatTimeToFirstReply(18 * 60_000), "18m");
assert.equal(formatTimeToFirstReply(3 * 3_600_000 + 20 * 60_000), "3h 20m");
assert.equal(formatTimeToFirstReply(2 * 86_400_000 + 4 * 3_600_000), "2d 4h");
assert.equal(formatTimeToFirstReply(24 * 3_600_000), "1d");

// ── Wiring pins ───────────────────────────────────────────────────────────────
const workspace = await readFile(new URL("../components/workspace.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
const analytics = await readFile(new URL("../components/familiar-analytics-view.tsx", import.meta.url), "utf8");

assert.match(
  workspace,
  /useEffect\(\(\) => \{\s*stampFirstOpenOnce\(\);\s*\}, \[\]\)/,
  "workspace stamps the first-open anchor once on mount",
);
assert.match(
  chatView,
  /\} else \{[^}]*stampFirstReplyOnce\(\);/,
  "chat-view stamps the first reply only on a non-error done",
);
assert.match(
  analytics,
  /first reply \{timeToFirstReply\} after first open/,
  "the session-pulse header surfaces time-to-first-reply",
);
assert.match(
  analytics,
  /timeToFirstReply \? </,
  "the funnel line hides entirely when the stamps are absent",
);

console.log("first-run-stamps.test.ts: ok");
