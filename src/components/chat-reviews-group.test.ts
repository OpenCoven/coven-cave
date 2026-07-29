// @ts-nocheck
// Source pins for the new-session launcher's Reviews group (cave-umgkh).
//
// Most Caves have no GitHub token, so the pin that matters most is the one
// about absence: an unconfigured or failing GitHub read must leave the group
// off the page entirely, never an error a brand-new chat can't act on.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const hook = readFileSync(new URL("../lib/use-review-requests.ts", import.meta.url), "utf8");
const emptyState = readFileSync(new URL("./chat-empty-state.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("./chat-new-dashboard.tsx", import.meta.url), "utf8");

test("the snapshot is one-shot, abort-guarded, focus-refreshed — never polled", () => {
  assert.match(hook, /new AbortController\(\)/, "the load allocates an abort controller");
  assert.match(hook, /controller\.signal\.aborted/, "aborted responses are ignored");
  assert.match(hook, /useRefreshOnFocus\(load, \{ enabled \}\)/, "the snapshot refreshes on window refocus");
  assert.doesNotMatch(hook, /setInterval/, "the starting page must not poll");
});

test("no token, a rejected token, or a thrown fetch all resolve to absence", () => {
  assert.match(
    hook,
    /const ok = Boolean\(json\.ok\) && Boolean\(json\.configured\);/,
    "the group needs BOTH a successful read and a configured token",
  );
  assert.match(
    hook,
    /\} catch \{[\s\S]{0,300}setConfigured\(false\);[\s\S]{0,80}setItems\(\[\]\);/,
    "a thrown fetch degrades to an empty snapshot",
  );
  assert.match(hook, /fetch\("\/api\/github\/assigned"/, "reads the established assigned route");
});

test("both new-session surfaces mount the group, and neither renders it empty", () => {
  for (const [name, source] of [["zero-turn page", emptyState], ["new-chat dashboard", dashboard]]) {
    assert.match(source, /useReviewRequests\(/, `${name} mounts the snapshot`);
    assert.match(
      source,
      /startFromGroup\("reviews", reviewRows\.length, reviews\.rows\.length\)/,
      `${name} counts the capped rows against every waiting review`,
    );
    assert.match(source, /\{reviewRows\.length > 0 \?/, `${name} renders no Reviews chrome when nothing waits`);
    assert.match(
      source,
      /aria-label=\{reviewRequestLabel\(row\)\}/,
      `${name} gives each row a full-context accessible name`,
    );
  }
});

test("rows reuse each surface's existing row grammar — no third vocabulary", () => {
  assert.match(
    emptyState,
    /className="cave-chat-empty-recent"[\s\S]{0,300}?aria-label=\{reviewRequestLabel\(row\)\}/,
    "the zero-turn page reuses its thread-row class",
  );
  assert.match(
    dashboard,
    /className="home-dash__recent-row"[\s\S]{0,300}?aria-label=\{reviewRequestLabel\(row\)\}/,
    "the dashboard reuses its recent-row class",
  );
});

test("Reviews sheds with Queue, before the recent threads", () => {
  // Both are extra-source groups (each costs a request); the page's own data
  // — board cards and threads — survives a tier longer.
  const css = readFileSync(new URL("../styles/home-dashboard.css", import.meta.url), "utf8");
  assert.match(
    css,
    /@container \(max-height: 760px\) \{\s*\n\s*\.home-dash__section--queue,\s*\n\s*\.home-dash__section--reviews \{/,
    "Queue and Reviews share the earlier shed tier",
  );
  assert.match(
    dashboard,
    /className="home-dash__section home-dash__section--reviews"/,
    "the Reviews section opts into that tier",
  );
});

test("starting a review opens the work in place", () => {
  assert.match(
    dashboard,
    /new CustomEvent\("cave:agents-new-chat", \{[\s\S]{0,200}initialPrompt: `Review \$\{url\}`/,
    "the dashboard briefs a new chat with the PR url",
  );
  assert.match(
    emptyState,
    /onClick=\{\(\) => onPrompt\?\.\(`Review \$\{row\.url\}`\)\}/,
    "the zero-turn page fills its own composer",
  );
});
