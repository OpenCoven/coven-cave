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
    assert.match(
      source,
      /if \(reviewRows\.length > 0\) \{/,
      `${name} contributes no Reviews band when nothing waits`,
    );
    assert.match(
      source,
      /ariaLabel: reviewRequestLabel\(row\)/,
      `${name} gives each tile a full-context accessible name`,
    );
  }
});

test("rows reuse the shared band grammar — no third vocabulary", () => {
  for (const [name, source] of [["zero-turn page", emptyState], ["new-chat dashboard", dashboard]]) {
    assert.match(
      source,
      /meta: reviewsGroup,[\s\S]{0,400}?ariaLabel: reviewRequestLabel\(row\)/,
      `${name} builds its Reviews tiles from the shared band model`,
    );
    assert.match(
      source,
      /from "@\/components\/chat-start-from-bands"/,
      `${name} renders through the shared launcher`,
    );
  }
});

test("Reviews sheds first — before Queue, and long before the Chats band", () => {
  // Both are extra-source groups (each costs a request); the page's own data
  // — board cards and threads — survives longer. Reviews is the quietest, so
  // it is the first band a short pane gives up.
  const css = readFileSync(new URL("../styles/home-dashboard.css", import.meta.url), "utf8");
  assert.match(
    css,
    /@container \(max-height: 760px\) \{\s*\n\s*\.cave-sf__band\[data-kind="reviews"\] \{/,
    "Reviews owns the earliest shed tier",
  );
  const tier = (kind) =>
    Number(
      css.match(
        new RegExp(
          `@container \\(max-height: (\\d+)px\\) \\{\\s*\\n\\s*\\.cave-sf__band\\[data-kind="${kind}"\\]`,
        ),
      )[1],
    );
  assert.ok(
    tier("reviews") > tier("queue") && tier("queue") > tier("chats"),
    "shed order is reviews, then queue, then chats",
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
    /onPick: \(\) => onPrompt\?\.\(`Review \$\{row\.url\}`\)/,
    "the zero-turn page fills its own composer",
  );
});
