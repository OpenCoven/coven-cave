// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./board-inspector.tsx", import.meta.url), "utf8");

// ── TimeoutBadge poll pauses when the tab is hidden ──────────────────────────
assert.match(
  src,
  /setInterval\(\(\) => \{ if \(!document\.hidden\) setTick/,
  "TimeoutBadge stops ticking while the tab is hidden",
);
assert.match(src, /addEventListener\("visibilitychange", onVisible\)/, "TimeoutBadge refreshes on re-show");
assert.match(src, /removeEventListener\("visibilitychange", onVisible\)/, "TimeoutBadge cleans up its visibility listener");

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

// ── Inline-style motion respects prefers-reduced-motion ──────────────────────
assert.match(src, /function usePrefersReducedMotion\(\): boolean/, "a reduced-motion subscription exists");
assert.match(src, /transition: reducedMotion \? "none" : "width 0\.2s/, "the progress bar drops its transition under reduced motion");
assert.match(src, /transition: reducedMotion \? "none" : "background 0\.15s"/, "the step checkbox drops its transition under reduced motion");
assert.match(src, /@media \(prefers-reduced-motion: reduce\) \{ \.step-actions \{ transition: none; \} \}/, "the step-actions hover reveal honors reduced motion");

console.log("board-inspector-a11y.test.ts: ok");
