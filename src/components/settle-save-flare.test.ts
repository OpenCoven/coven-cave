// @ts-nocheck
// Pins for the completion-flare cooldown model (cave-q06w) — session-settle
// and memory-save join the summoning-flare vocabulary (cave-hshy, cave-kx5y)
// but, unlike PR-merge/card-done, these events are high-frequency, so both
// wirings must keep the two cooldown gates: significance (long runs only /
// manual saves only) and frequency (global per-kind cooldown). Flares stay
// visual-only garnish — role=status announcements carry the information —
// and reduced-motion collapses them entirely.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const mdEditor = readFileSync(new URL("./md-editor/md-editor.tsx", import.meta.url), "utf8");
const activityCss = readFileSync(new URL("../styles/cave-chat/activity.css", import.meta.url), "utf8");
const mdEditorCss = readFileSync(new URL("../styles/md-editor.css", import.meta.url), "utf8");

// ── Session-settle (chat-view MetaLine) ─────────────────────────────────────
assert.match(
  chatView,
  /if \(prev !== "streaming" \|\| state !== "complete"\) return;/,
  "settle flare fires only on the streaming→complete transition, not on mount or re-render",
);
assert.match(
  chatView,
  /if \(\(durationMs \?\? 0\) < SETTLE_MIN_RUN_MS\) return;/,
  "significance gate: only long runs flare — short replies are their own feedback",
);
assert.match(
  chatView,
  /if \(!readCelebrationsEnabled\(\) \|\| !shouldFlare\("session-settle"\)\) return;/,
  "settle flare respects the celebrations pref and the global per-kind cooldown",
);
assert.match(
  chatView,
  /setSettleFlare\(true\);\n\s*window\.setTimeout\(\(\) => setSettleFlare\(false\), 900\);/,
  "settle reward state self-clears so re-renders can't replay the flare",
);
assert.match(
  chatView,
  /settleFlare \? " cave-chat-meta-line--reward" : ""/,
  "the meta line root wears the reward class",
);

// ── Memory-save (MdEditor) ──────────────────────────────────────────────────
assert.match(
  mdEditor,
  /const save = useCallback\(async \(source: "manual" \| "auto" = "manual"\)/,
  "save() carries its trigger source; unannotated callers (toolbar, Cmd+S, conflict keep-mine) count as manual",
);
assert.match(
  mdEditor,
  /void saveRef\.current\("auto"\), AUTOSAVE_DEBOUNCE_MS/,
  "the debounced autosave path declares itself auto — ambient bookkeeping never flares",
);
assert.match(
  mdEditor,
  /if \(source === "manual" && readCelebrationsEnabled\(\) && shouldFlare\("memory-save"\)\) \{/,
  "save flare is manual-only, pref-gated, and cooldown-gated",
);
assert.match(
  mdEditor,
  /setSaveFlare\(true\);\n\s*window\.setTimeout\(\(\) => setSaveFlare\(false\), 900\);/,
  "save reward state self-clears so re-renders can't replay the flare",
);
assert.match(
  mdEditor,
  /saveFlare \? " md-editor--reward" : ""/,
  "the editor root wears the reward class",
);

// ── CSS: summoning vocabulary + reduced-motion collapse ─────────────────────
assert.match(
  activityCss,
  /cave-chat-settle-flare 700ms var\(--ease-decelerate\) forwards/,
  "settle flare speaks the 700ms decelerate one-shot vocabulary",
);
assert.match(
  activityCss,
  /@media \(prefers-reduced-motion: reduce\) \{\n\s*\.cave-chat-meta-line--reward \{ animation: none; \}/,
  "reduced motion collapses the settle flare entirely",
);
assert.match(
  mdEditorCss,
  /md-editor-save-flare 700ms var\(--ease-decelerate\) forwards/,
  "save flare speaks the 700ms decelerate one-shot vocabulary",
);
assert.match(
  mdEditorCss,
  /@media \(prefers-reduced-motion: reduce\) \{\n\s*\.md-editor--reward \{ animation: none; \}/,
  "reduced motion collapses the save flare entirely",
);

console.log("settle-save-flare: all pins hold");
