import assert from "node:assert/strict";

import { deriveStatStrip, openTaskCount, railRowMeta } from "./detail-stats.ts";
import type { Card } from "../cave-board-types.ts";

const card = (status: string) => ({ id: status, title: status, status }) as unknown as Card;

// Open tasks exclude done cards only — every other status is live work.
assert.equal(openTaskCount([]), 0);
assert.equal(openTaskCount([card("todo"), card("running"), card("done"), card("review")]), 3);

// The strip binds to real counts; familiars show granted-of-roster; empty
// slots render an em dash, never a fabricated value.
assert.deepEqual(
  deriveStatStrip({
    sessionCount: 4,
    openTasks: 2,
    grantedCount: 3,
    rosterCount: 5,
    lastActiveLabel: "2h ago",
  }),
  { sessions: "4", openTasks: "2", familiars: "3 / 5", lastActive: "2h ago" },
);
assert.deepEqual(
  deriveStatStrip({
    sessionCount: 0,
    openTasks: 0,
    grantedCount: 0,
    rosterCount: 0,
    lastActiveLabel: null,
  }),
  { sessions: "0", openTasks: "0", familiars: "—", lastActive: "—" },
);

// Rail meta joins only the halves that exist.
assert.equal(railRowMeta(3, "main"), "3 chats · main");
assert.equal(railRowMeta(1, null), "1 chat");
assert.equal(railRowMeta(0, "main"), "main");
assert.equal(railRowMeta(0, null), "");

console.log("detail-stats.test.ts: ok");
