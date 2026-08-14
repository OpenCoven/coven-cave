import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ChatEnvironmentPanel (cave-68vv) — the floating Environment HUD on wide chat
// panes. React wiring is pinned by source shape; the visibility / labelling /
// PR-row / diff-total logic is behavioral in
// src/lib/chat-environment-panel-model.test.ts.

const panel = readFileSync(
  new URL("./chat-environment-panel.tsx", import.meta.url),
  "utf8",
);

// Data must ride the SHARED pollers — no private /api/changes fetch loop.
assert.match(panel, /useChangesSummary\(\s*root,\s*summaryActive,?\s*\)/, "status rides the shared changes-summary poll");
assert.doesNotMatch(panel, /fetch\(/, "the panel itself performs no fetches (summary + PR hooks own the network)");
assert.match(panel, /useBranchPr\(visible \? root : undefined, branch\)/, "PR probe only runs once the panel is actually visible");

// The poll is active-gated so narrow panes / rail-open layouts / turnless
// chats skip the work entirely.
assert.match(
  panel,
  /summaryActive = Boolean\(root\) && hasTurns && measured && !railOpen/,
  "summary poll gated on root + turns + measured pane + rail closed",
);

// Rows LAUNCH the existing surfaces instead of duplicating them.
assert.match(panel, /new CustomEvent\("cave:changes-open"\)/, "Changes / commit / create-PR rows open the code rail's Changes tab");
assert.match(panel, /GitBranchMenuPopover/, "branch row anchors the shared branch menu (switch branch / new worktree)");
assert.match(panel, /onSwitched=\{reload\}/, "a branch switch forces a fresh summary instead of waiting out the poll");

// Hides while the inline code rail is open — the rail is the full surface.
assert.match(panel, /addEventListener\("cave:code-rail-visibility"/, "tracks inline code-rail visibility");
assert.match(panel, /removeEventListener\("cave:code-rail-visibility"/, "visibility listener cleaned up on unmount");

// Wide-pane gate measures the panel's own sticky wrapper via ResizeObserver —
// per-pane, split-pane safe, no ancestor container-type needed.
assert.match(panel, /new ResizeObserver\(measure\)/, "pane width measured with a ResizeObserver");
assert.match(panel, /observer\.disconnect\(\)/, "ResizeObserver disconnected on unmount");
assert.match(panel, /resolveEnvPanelVisible\(\{/, "visibility decided by the pure model (tested behaviorally)");

// Overlay behavior: a sticky, height-0, pointer-transparent wrapper so the
// transcript's layout and hit-testing are untouched; only the card itself
// re-enables pointer events.
assert.match(panel, /pointer-events-none sticky top-0 z-30 flex h-0 w-full justify-end/, "wrapper is sticky, zero-height and pointer-transparent");
assert.match(panel, /pointer-events-auto/, "the card re-enables pointer events");

// The card must stay legible over the transcript even when the theme /
// backdrop mode makes --bg-raised translucent: an opaque --bg-base floor
// under the raised tint, plus a frosted blur (repo convention for floating
// HUDs, e.g. grimoire-graph-view).
assert.match(
  panel,
  /linear-gradient\(var\(--bg-raised\),[_ ]var\(--bg-raised\)\),[_ ]var\(--bg-base\)/,
  "card pins an opaque bg-base floor under the raised tint",
);
const blurCount = panel.match(/backdrop-blur-md/g)?.length ?? 0;
assert.ok(blurCount >= 2, "expanded card AND collapsed pill are frosted (backdrop-blur-md)");

// Collapse preference persists under a VERSIONED key, hydrated post-mount
// (SSR-safe) like CODE_RAIL_PIN_KEY.
assert.match(panel, /ENV_PANEL_COLLAPSED_KEY = "cave:chat-env-panel:collapsed:v1"/, "versioned localStorage key");
assert.match(panel, /localStorage\.getItem\(ENV_PANEL_COLLAPSED_KEY\)/, "collapse state hydrated after mount");

// Accessibility: labelled landmark card, labelled collapse/expand controls,
// menu semantics on the branch trigger.
assert.match(panel, /aria-label="Environment"/, "card is a labelled section");
assert.match(panel, /aria-label="Collapse environment panel"/, "collapse control labelled");
assert.match(panel, /aria-label="Show environment panel"/, "collapsed pill labelled");
assert.match(panel, /aria-haspopup="menu"/, "branch row announces its menu");
assert.match(panel, /className=\{`\$\{ROW_CLASS\}/, "rows share the focus-ring row class");
assert.match(panel, /focus-ring/, "interactive elements carry the global focus ring");

// ── ChatView wiring ───────────────────────────────────────────────────────────
const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

assert.match(
  chatView,
  /<ChatEnvironmentPanel\n\s+projectRoot=\{session\?\.project_root \?\? projectRoot \?\? null\}/,
  "panel keys on the SESSION-root derivation (cave-r0gt)",
);
assert.match(chatView, /runtime=\{session\?\.runtime \?\? null\}/, "runtime rides the session row for the Local/ssh label");
assert.match(chatView, /hasTurns=\{turns\.length > 0\}/, "empty-state chats keep the transcript clean");
// The panel must live INSIDE the transcript scroll container so its sticky
// wrapper tracks the reading pane, not the whole chat column.
const transcriptIdx = chatView.indexOf('className="cave-chat-transcript relative min-h-0 flex-1 overflow-y-auto"');
const panelIdx = chatView.indexOf("<ChatEnvironmentPanel");
const threadIdx = chatView.indexOf('className="cave-chat-thread"');
assert.ok(transcriptIdx !== -1 && panelIdx !== -1 && threadIdx !== -1, "transcript, panel and thread markers all present");
assert.ok(
  transcriptIdx < panelIdx && panelIdx < threadIdx,
  "panel mounts inside the transcript scroll container, before the thread",
);

console.log("chat-environment-panel.test.ts: ok");
