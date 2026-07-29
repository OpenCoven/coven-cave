// @ts-nocheck
// Source pins for the new-session launcher's Queue group (cave-3lonn).
//
// The group is the launcher's third source of work, and it is the first one
// that costs a request — so what it must NOT do is as pinned as what it does:
// no polling, no chrome when the source is empty, and no second row
// vocabulary (the home first-load CSS cap has no room for one).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const hook = readFileSync(new URL("../lib/use-queue-followups.ts", import.meta.url), "utf8");
const emptyState = readFileSync(new URL("./chat-empty-state.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("./chat-new-dashboard.tsx", import.meta.url), "utf8");

test("the snapshot is one-shot, abort-guarded, focus-refreshed — never polled", () => {
  assert.match(hook, /new AbortController\(\)/, "the load allocates an abort controller");
  assert.match(hook, /controller\.signal\.aborted/, "aborted responses are ignored");
  assert.match(hook, /useRefreshOnFocus\(load, \{ enabled \}\)/, "the snapshot refreshes on window refocus");
  assert.doesNotMatch(hook, /setInterval/, "the starting page must not poll");
});

test("the Queue project comes from the Queue's own selection, not the chat's", () => {
  assert.match(
    hook,
    /fetch\("\/api\/queue\/readiness"/,
    "readiness owns which project the Queue means",
  );
  assert.match(
    hook,
    /\/api\/beads\?mode=ready&projectRoot=\$\{encodeURIComponent\(project\.root\)\}/,
    "ready beads are read for that project root",
  );
  assert.match(
    hook,
    /if \(!project\?\.root\) \{[\s\S]{0,120}setBeads\(\[\]\)/,
    "no selected project resolves to an empty snapshot, not an error",
  );
});

test("a failing queue adapter degrades to absence, not to a broken group", () => {
  assert.match(
    hook,
    /\} catch \{[\s\S]{0,400}setBeads\(\[\]\);/,
    "a brand-new chat can't act on a queue failure — swallow to empty",
  );
});

test("both new-session surfaces mount the group, and neither renders it empty", () => {
  for (const [name, source] of [["zero-turn page", emptyState], ["new-chat dashboard", dashboard]]) {
    assert.match(source, /useQueueFollowUps\(familiar\.id/, `${name} mounts the snapshot`);
    assert.match(
      source,
      /startFromGroup\("queue", queueRows\.length, queueFollowUps\.rows\.length\)/,
      `${name} counts the capped rows against every parked follow-up`,
    );
    assert.match(
      source,
      /\{queueRows\.length > 0 \?/,
      `${name} renders no Queue chrome when nothing is parked`,
    );
    assert.match(
      source,
      /aria-label=\{queueFollowUpLabel\(row\)\}/,
      `${name} gives each row a full-context accessible name`,
    );
  }
});

test("rows reuse each surface's existing row grammar — no second vocabulary", () => {
  assert.match(
    emptyState,
    /className="cave-chat-empty-recent"[\s\S]{0,300}?aria-label=\{queueFollowUpLabel\(row\)\}/,
    "the zero-turn page reuses its thread-row class",
  );
  assert.match(
    dashboard,
    /className="home-dash__recent-row"[\s\S]{0,300}?aria-label=\{queueFollowUpLabel\(row\)\}/,
    "the dashboard reuses its recent-row class",
  );
});

test("the dashboard sheds Queue before its recent threads", () => {
  // The mock encodes group priority as width — chats widest, queue smallest —
  // so on a short pane the Queue goes first and Chats survive one tier longer.
  const css = readFileSync(new URL("../styles/home-dashboard.css", import.meta.url), "utf8");
  const queueTier = css.match(/@container \(max-height: (\d+)px\) \{\s*\n\s*\.home-dash__section--queue/);
  const recentTier = css.match(/@container \(max-height: (\d+)px\) \{\s*\n\s*\.home-dash__section--recent/);
  assert.ok(queueTier && recentTier, "both groups declare a shed tier");
  assert.ok(
    Number(queueTier[1]) > Number(recentTier[1]),
    "Queue hides at a taller pane than the recent threads — it sheds first",
  );
  assert.match(
    dashboard,
    /className="home-dash__section home-dash__section--queue"/,
    "the Queue section opts into its own shed tier",
  );
});

test("starting a follow-up opens the work in place", () => {
  // The dashboard has no composer of its own, so it briefs a fresh chat
  // through the established new-chat bridge; the zero-turn page already has a
  // composer, so it fills that instead of navigating away.
  assert.match(
    dashboard,
    /new CustomEvent\("cave:agents-new-chat", \{[\s\S]{0,200}initialPrompt: `Pick up \$\{beadId\}: \$\{title\}`/,
    "the dashboard briefs a new chat with the bead",
  );
  assert.match(
    emptyState,
    /onClick=\{\(\) => onPrompt\?\.\(`Pick up \$\{row\.id\}: \$\{row\.title\}`\)\}/,
    "the zero-turn page fills its own composer",
  );
});
