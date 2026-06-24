// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./board-inspector.tsx", import.meta.url), "utf8");

// ── TimeoutBadge poll pauses when hidden — via the shared usePausablePoll hook ─
assert.match(
  src,
  /usePausablePoll\(\(\) => setTick\(\(n\) => n \+ 1\), 60_000\)/,
  "TimeoutBadge re-renders once a minute through the shared pausable-poll hook",
);
assert.match(src, /import \{ usePausablePoll \} from "@\/lib\/use-pausable-poll"/, "TimeoutBadge uses the centralized hidden-pause poll");

// ── GitHub-attach fetch drops stale / post-close responses ───────────────────
assert.match(
  src,
  /fetch\("\/api\/github\/assigned"[\s\S]*?if \(cancelled\) return;[\s\S]*?setItems/,
  "the GitHub attach loader guards against a superseded/post-unmount response",
);
assert.match(src, /\.finally\(\(\) => \{ if \(!cancelled\) setLoading\(false\); \}\)/, "loading flag only clears while the effect is live");
assert.match(src, /return \(\) => \{ cancelled = true; \};/, "the GitHub attach effect cancels in-flight work on cleanup");

// ── saveToLibrary doesn't touch state after the inspector closes ─────────────
assert.match(src, /const mountedRef = useRef\(true\);/, "LinksSection tracks mounted state");
assert.match(src, /if \(mountedRef\.current\) setSavedToLibrary/, "save badge updates are gated on mounted");
assert.match(src, /if \(!mountedRef\.current\) return;[\s\S]*?delete next\[url\]/, "the deferred badge-clear bails out if unmounted");

// ── Step toggle is a real checkbox, named by its step ────────────────────────
assert.match(
  src,
  /role="checkbox"\s+aria-checked=\{step\.done\}\s+aria-label=\{step\.text \|\| "Step"\}/,
  "the step toggle exposes checkbox semantics with the step text as its name",
);

// ── Inline-style motion respects prefers-reduced-motion (shared hook) ────────
assert.match(src, /import \{ usePrefersReducedMotion \} from "@\/lib\/use-prefers-reduced-motion"/, "reduced-motion uses the canonical shared hook, not a local copy");
assert.doesNotMatch(src, /function usePrefersReducedMotion\(\): boolean/, "the local reduced-motion duplicate is removed");
assert.match(src, /transition: reducedMotion \? "none" : "width 0\.2s/, "the progress bar drops its transition under reduced motion");
assert.match(src, /transition: reducedMotion \? "none" : "background 0\.15s"/, "the step checkbox drops its transition under reduced motion");
assert.match(src, /@media \(prefers-reduced-motion: reduce\) \{ \.step-actions \{ transition: none; \} \}/, "the step-actions hover reveal honors reduced motion");

console.log("board-inspector-a11y.test.ts: ok");
