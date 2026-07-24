// @ts-nocheck
import assert from "node:assert/strict";
import {
  DEFAULT_CHAT_AUTO_RENAME_POLICY,
  MAX_RENAME_TURNS,
  MIN_RENAME_TURNS,
  clampRenameTurns,
  isAutoOwnedTitle,
  isRenameDueAtTurn,
  normalizeChatAutoRenamePolicy,
  renameTitleFromLatestExchange,
} from "./chat-auto-rename.ts";

// ── Defaults ─────────────────────────────────────────────────────────────────
// Opt-in: renaming a chat out from under someone is surprising, so it is off.
assert.equal(DEFAULT_CHAT_AUTO_RENAME_POLICY.enabled, false);
assert.equal(DEFAULT_CHAT_AUTO_RENAME_POLICY.everyTurns, 4);
assert.equal(DEFAULT_CHAT_AUTO_RENAME_POLICY.preserveManualTitles, true);

// ── Normalizer tolerates junk, clamps the cadence ────────────────────────────
assert.deepEqual(normalizeChatAutoRenamePolicy(null), DEFAULT_CHAT_AUTO_RENAME_POLICY);
assert.deepEqual(normalizeChatAutoRenamePolicy("nope"), DEFAULT_CHAT_AUTO_RENAME_POLICY);
assert.equal(normalizeChatAutoRenamePolicy({ everyTurns: 0 }).everyTurns, MIN_RENAME_TURNS);
assert.equal(normalizeChatAutoRenamePolicy({ everyTurns: 999 }).everyTurns, MAX_RENAME_TURNS);
assert.equal(normalizeChatAutoRenamePolicy({ everyTurns: 6.9 }).everyTurns, 6);
assert.equal(normalizeChatAutoRenamePolicy({ everyTurns: "x" }).everyTurns, 4);
assert.equal(normalizeChatAutoRenamePolicy({ enabled: true }).enabled, true);
assert.equal(
  normalizeChatAutoRenamePolicy({ preserveManualTitles: false }).preserveManualTitles,
  false,
);
assert.equal(clampRenameTurns(1, 4), MIN_RENAME_TURNS);
assert.equal(clampRenameTurns(NaN, 4), 4);

// ── Cadence: due at positive multiples of everyTurns, never before ───────────
assert.equal(isRenameDueAtTurn(1, 4), false, "turn 1 is the first-exchange name's job");
assert.equal(isRenameDueAtTurn(3, 4), false);
assert.equal(isRenameDueAtTurn(4, 4), true);
assert.equal(isRenameDueAtTurn(8, 4), true);
assert.equal(isRenameDueAtTurn(6, 4), false);
assert.equal(isRenameDueAtTurn(2, 2), true);
assert.equal(isRenameDueAtTurn(0, 4), false);
assert.equal(isRenameDueAtTurn(4.5, 4), false, "non-integer turn counts never fire");

// ── Ownership: manual titles are sacred (preserveManualTitles on) ────────────
const defaults = new Set(["New chat", "Fix the sync path"]);
assert.equal(
  isAutoOwnedTitle({ current: null, lastAutoTitle: null, autoDefaults: defaults, preserveManualTitles: true }),
  true,
  "no title yet → ours to set",
);
assert.equal(
  isAutoOwnedTitle({ current: "New chat", lastAutoTitle: null, autoDefaults: defaults, preserveManualTitles: true }),
  true,
  "still an auto default → replaceable",
);
assert.equal(
  isAutoOwnedTitle({ current: "Deploying to prod", lastAutoTitle: "Deploying to prod", autoDefaults: defaults, preserveManualTitles: true }),
  true,
  "we set it last → replaceable",
);
assert.equal(
  isAutoOwnedTitle({ current: "My hand-picked name", lastAutoTitle: "Deploying to prod", autoDefaults: defaults, preserveManualTitles: true }),
  false,
  "a human's title is never overwritten while preserve is on",
);
assert.equal(
  isAutoOwnedTitle({ current: "My hand-picked name", lastAutoTitle: null, autoDefaults: defaults, preserveManualTitles: false }),
  true,
  "preserve off → auto-rename may take over any title",
);

// ── Derivation reuses the pure chatSummaryTitle over the LATEST exchange ──────
assert.equal(
  renameTitleFromLatestExchange({ userText: "help me migrate the auth service to OAuth", assistantText: "" }),
  "Migrate the auth service to OAuth",
);
assert.equal(renameTitleFromLatestExchange({ userText: "", assistantText: "" }), null);
assert.equal(
  renameTitleFromLatestExchange({ userText: null, assistantText: "## Rollback plan\nsteps…" }),
  "Rollback plan",
  "falls back to an assistant heading when the user turn is empty",
);

console.log("chat-auto-rename.test.ts ok");
