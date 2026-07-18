// @ts-nocheck
// Loading/empty/error discipline (cave-5qmm): one loading language per
// surface (the shared shimmer skeleton), and offline/error notices that carry
// their own remedy instead of pointing at chrome that may not be visible.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// ── Chat meta line: the offline notice is self-remedying ────────────────────
const chatView = read("./chat-view.tsx");
assert.doesNotMatch(
  chatView,
  /start it from the banner above/,
  "The offline meta line no longer references the (dismissable) banner",
);
assert.match(
  chatView,
  /function MetaLineStartDaemon\(\)/,
  "The offline meta line owns an inline Start-daemon action",
);
assert.match(
  chatView,
  /MetaLineStartDaemon[\s\S]{0,400}fetch\("\/api\/daemon\/start", \{ method: "POST" \}\)/,
  "The inline action posts /api/daemon/start like the settings/onboarding start buttons",
);
assert.match(
  chatView,
  /\{state === "offline" \? <MetaLineStartDaemon \/> : null\}/,
  "The action renders only in the offline state",
);
assert.match(
  chatView,
  /className="cave-chat-meta-line__action focus-ring"/,
  "The inline action is keyboard-focusable with the shared focus ring",
);

const chatCss = read("../styles/cave-chat.css");
assert.match(
  chatCss,
  /\.cave-chat-meta-line__action:hover \{\s*color: var\(--accent-presence\);/,
  "Hover feedback uses the accent token",
);
assert.match(
  chatCss,
  /\.cave-chat-meta-line__action:disabled \{[\s\S]{0,120}cursor: default;/,
  "The disabled (starting…) state drops the affordance",
);

// ── Marketplace: one loading language (skeleton), no mixed text cue ─────────
const marketplace = read("./marketplace-view.tsx");
assert.doesNotMatch(
  marketplace,
  /Loading the catalog/,
  "Marketplace no longer mixes a 'Loading the catalog…' string with skeleton rows",
);
assert.match(
  marketplace,
  /\{!loaded \? \([\s\S]{0,300}?<Skeleton variant="text-sm"/,
  "The browse result-count line shimmers while the catalog loads",
);

// ── Roster memory snapshot: shimmer, not dead text ──────────────────────────
const familiars = read("./familiars-view.tsx");
assert.doesNotMatch(
  familiars,
  />Loading memory…</,
  "Roster cards no longer show a bare 'Loading memory…' line",
);
assert.match(
  familiars,
  /memoryStatus === "loading" \? \([\s\S]{0,400}?<Skeleton variant="text-sm"/,
  "Roster memory snapshot renders the shared Skeleton while loading",
);

// ── Ad-hoc animate-pulse placeholders converted to the shared shimmer ───────
// animate-pulse stays legitimate for live-status dots and streaming carets —
// but data-loading PLACEHOLDERS must use .ui-skeleton so they shimmer and
// degrade to static under prefers-reduced-motion via one contract.
for (const [file, label] of [
  ["./chat-list.tsx", "Chat list boot + content-search placeholders"],
  ["./capability-card.tsx", "Capability card placeholder"],
  ["./automations-view.tsx", "Schedules first-load placeholder"],
]) {
  const src = read(file);
  assert.match(src, /ui-skeleton/, `${label} uses the shared shimmer skeleton`);
}
assert.doesNotMatch(
  read("./capability-card.tsx"),
  /animate-pulse/,
  "Capability placeholder no longer uses the static animate-pulse idiom",
);
assert.doesNotMatch(
  read("./automations-view.tsx"),
  /animate-pulse rounded-lg/,
  "Schedules placeholder no longer uses the static animate-pulse idiom",
);

// ── The shared skeleton's degradation contract stays pinned ─────────────────
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
assert.match(
  globals,
  /animation: ui-skeleton-shimmer 1\.4s ease-in-out infinite;/,
  "ui-skeleton shimmers (perceived progress on cold routes)",
);
assert.match(
  globals,
  /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.ui-skeleton \{ animation: none; opacity: 0\.65; \}/,
  "ui-skeleton degrades to a static wash under prefers-reduced-motion",
);

console.log("loading-discipline.test.ts: ok");
