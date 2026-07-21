import assert from "node:assert/strict";
import {
  ENV_PANEL_MIN_WIDTH,
  environmentLabel,
  prRowAction,
  resolveEnvPanelVisible,
  sumFileTotals,
  type EnvPanelSignals,
} from "./chat-environment-panel-model.ts";

// ── resolveEnvPanelVisible ────────────────────────────────────────────────────
// The floating Environment HUD only earns its overlay footprint on genuinely
// wide panes with a real repo behind the chat and no code rail already open.

const base: EnvPanelSignals = {
  paneWidth: ENV_PANEL_MIN_WIDTH,
  hasRepo: true,
  loaded: true,
  notARepo: false,
  railOpen: false,
  hasTurns: true,
};

assert.equal(resolveEnvPanelVisible(base), true, "wide + repo + turns + loaded shows the panel");
assert.equal(
  resolveEnvPanelVisible({ ...base, paneWidth: ENV_PANEL_MIN_WIDTH - 1 }),
  false,
  "below the width threshold the panel never overlays the conversation",
);
assert.equal(
  resolveEnvPanelVisible({ ...base, paneWidth: null }),
  false,
  "unmeasured panes stay hidden — no flash before the first ResizeObserver tick",
);
assert.equal(resolveEnvPanelVisible({ ...base, hasRepo: false }), false, "no project root → nothing to show");
assert.equal(resolveEnvPanelVisible({ ...base, loaded: false }), false, "waits for the first /api/changes settle");
assert.equal(resolveEnvPanelVisible({ ...base, notARepo: true }), false, "non-repo roots have no git context");
assert.equal(
  resolveEnvPanelVisible({ ...base, railOpen: true }),
  false,
  "the inline code rail is the full surface this HUD abbreviates — never both",
);
assert.equal(resolveEnvPanelVisible({ ...base, hasTurns: false }), false, "the empty-state hero stays clean");

// ── environmentLabel ──────────────────────────────────────────────────────────
// Local/unknown runtimes read "Local"; ssh runtimes surface the host.

assert.equal(environmentLabel(null), "Local");
assert.equal(environmentLabel(undefined), "Local");
assert.equal(environmentLabel("local:/Users/x/repo"), "Local");
assert.equal(environmentLabel("ssh:vm-1:/srv/work"), "vm-1");
assert.equal(environmentLabel("ssh:vm-1"), "vm-1");
assert.equal(environmentLabel("garbage"), "Local", "unparseable runtimes fall back to Local");

// ── prRowAction ───────────────────────────────────────────────────────────────
// Only an OPEN PR flips the row to a view link; merged/closed branches offer
// "Create pull request" again (their PR no longer represents outbound work).

assert.deepEqual(prRowAction(null), { kind: "create", label: "Create pull request" });
assert.deepEqual(
  prRowAction({ number: 42, url: "https://github.com/o/r/pull/42", state: "OPEN", isDraft: false }),
  { kind: "view", label: "Pull request #42", url: "https://github.com/o/r/pull/42" },
);
assert.deepEqual(
  prRowAction({ number: 7, url: "https://github.com/o/r/pull/7", state: "OPEN", isDraft: true }),
  { kind: "view", label: "Pull request #7 · draft", url: "https://github.com/o/r/pull/7" },
);
assert.equal(
  prRowAction({ number: 9, url: "https://github.com/o/r/pull/9", state: "MERGED", isDraft: false }).kind,
  "create",
  "a merged PR is not this branch's outbound work anymore",
);
assert.equal(
  prRowAction({ number: 9, url: "", state: "OPEN", isDraft: false }).kind,
  "create",
  "an OPEN PR without a URL can't be a view link",
);

// ── sumFileTotals ─────────────────────────────────────────────────────────────
// Untracked files carry no numstat counts and simply don't contribute.

assert.deepEqual(sumFileTotals(undefined), { additions: 0, deletions: 0 });
assert.deepEqual(sumFileTotals("nope"), { additions: 0, deletions: 0 });
assert.deepEqual(sumFileTotals([]), { additions: 0, deletions: 0 });
assert.deepEqual(
  sumFileTotals([
    { path: "a.ts", insertions: 10, deletions: 2 },
    { path: "b.ts", insertions: 5 },
    { path: "untracked.ts" },
    null,
    { path: "c.ts", insertions: Number.NaN, deletions: 3 },
  ]),
  { additions: 15, deletions: 5 },
  "missing / NaN counts are skipped, the rest sum",
);

console.log("chat-environment-panel-model.test.ts: ok");
