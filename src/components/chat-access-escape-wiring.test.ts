// @ts-nocheck
//
// Guard (#6445): Chat's in-place access actions keep their invariants.
// - A read-only project refusing a Build turn is not revoked access: the
//   transcript, Retry and the fix row stay instead of "Chat access changed."
// - The refusal code is read from a clone, so the message branches that
//   consume the body still see it.
// - Grant changes run only from the confirmed button handlers, never from a
//   stream event or model output.
// - A Build press is a per-chat override; the composer menu keeps the shared
//   default and a pick there ends the override.
// The decisions themselves are unit-tested in src/lib/chat-access-escape.test.ts
// and driven in tests/chat-access-escape.spec.ts.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const bar = await readFile(new URL("./chat-access-bar.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /const refusalCode = res\.ok\s*\? undefined\s*: await res\.clone\(\)\.json\(\)/,
  "the send refusal code is read from a clone before any branch consumes the body",
);
assert.match(
  source,
  /const accessLevelRefusal = refusalCode === "project_write_access_required";\s*if \(\(res\.status === 401 \|\| res\.status === 403\) && !accessLevelRefusal\) \{\s*invalidateChatAccess\(/,
  "a read-only project's Build refusal does not invalidate chat access",
);
assert.match(
  source,
  /case "error": \{\s*setError\(ev\.message\);\s*setLastFailedSend\(request\);\s*if \(isAccessRefusalCode\(ev\.code\)\) \{\s*setAccessRefusal\(/,
  "a streamed access refusal keeps the failed send and records the refusal for its fix row",
);

// Grants change only from the two confirmed handlers.
const grantCalls = source.match(/grantProjectAccess\(/g) ?? [];
const undoCalls = source.match(/undoProjectGrant\(/g) ?? [];
assert.equal(grantCalls.length, 1, "one grant call site, inside grantChatProjectWrite");
assert.equal(undoCalls.length, 1, "one undo call site, inside undoChatGrant");
assert.match(source, /async function grantChatProjectWrite\(retry: boolean\) \{[\s\S]*?await grantProjectAccess\(fetch,/);
assert.match(source, /async function undoChatGrant\(\) \{[\s\S]*?await undoProjectGrant\(fetch, undo\);/);
const grantHandlerUses = source.match(/grantChatProjectWrite\(/g) ?? [];
assert.equal(grantHandlerUses.length, 3, "the grant handler is defined once and wired only to the bar and the fix row");
assert.match(source, /onGrantWrite=\{accessProject \? \(\) => void grantChatProjectWrite\(false\) : undefined\}/);
assert.match(source, /onGrantWriteAndRetry: \(\) => void grantChatProjectWrite\(true\)/);
// Both grant buttons only open a confirmation; the confirm button runs the grant.
assert.equal((bar.match(/onClick=\{\(\) => setConfirming\(true\)\}/g) ?? []).length, 2, "both grant buttons open the confirmation first");
assert.match(bar, /Confirm write access/);
assert.match(bar, /You can undo this\./);

// Per-chat access: the shared prefs keep the composer default.
assert.match(
  source,
  /writeChatComposerPrefs\([^)]*\{ thinkingEffort, responseSpeed, permissionMode \}\);/,
  "only the shared composer default is written to the composer prefs",
);
assert.match(source, /const effectivePermissionMode: CommandPermissionMode = chatAccessOverride \?\? permissionMode;/);
assert.match(source, /data-access-mode=\{effectivePermissionMode\}/);
assert.match(source, /function buildThisPlan\(\) \{[\s\S]*?setChatAccess\("full"\);[\s\S]*?sendRaw\(BUILD_PLAN_PROMPT,[\s\S]*?permissionMode: "full"/);

// The bar never offers Build that the runtime reported unavailable.
assert.match(bar, /const buildBlocked = buildAccess\?\.available === false \? buildAccess\.message : null;/);
for (const label of ["Build this plan", "Switch to Build", "Give write access…"]) {
  const index = bar.indexOf(label);
  assert.ok(index > 0, label);
  const guard = bar.slice(bar.lastIndexOf("{explore && !buildBlocked", index), index);
  assert.ok(guard.startsWith("{explore && !buildBlocked"), `${label} is gated on Explore and an available Build`);
}
// A grant made while a plan is waiting keeps the plan one press away.
assert.match(bar, /\{!explore && grantUndo && !buildBlocked && planReady \? \(\s*<Button[^>]*onClick=\{onBuildPlan\}>\s*Build this plan/);
// The plan cue belongs to a Claude chat: other runtimes can show the same tool names.
assert.match(source, /const latestPlanReady = Boolean\(\s*modelHarness === "claude" &&/);
// A refused stale Undo unmounts the focused button, so focus returns to the composer.
assert.match(
  source,
  /failure\.code === "grant_changed"\) \{\s*setGrantUndo\(null\);\s*priorChatAccessRef\.current = null;\s*keepFocusInChat\(pressed\);/,
);
// Outcomes are announced.
assert.match(bar, /role="status"/);
assert.match(source, /announce\(`\$\{familiar\.display_name\} can now change files in \$\{project\.name\}\.`, "polite"\)/);
