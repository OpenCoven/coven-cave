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

assert.match(src, /import \{ openExternalUrl \} from "@\/lib\/open-external"/, "inline PAT setup imports the system-browser opener");
assert.match(src, /onClick=\{\(\) => void openExternalUrl\(GITHUB_PAT_URL\)\}/, "inline PAT setup opens GitHub token creation outside the local app");
assert.doesNotMatch(src, /href="https:\/\/github\.com\/settings\/tokens\/new/, "inline PAT setup no longer uses a plain localhost-bound anchor");

// ── Attachments section: add/remove are accessible and go through onPatch ────
assert.match(src, /function AttachmentsSection\(/, "the inspector has an editable AttachmentsSection");
assert.match(
  src,
  /const converted = await Promise\.all\(picked\.map\(\(file\) => fileToAttachment\(file\)\)\)/,
  "added files are converted client-side via the shared fileToAttachment helper",
);
assert.match(
  src,
  /onPatch\(card\.id, \{ attachments: attachments\.filter\(\(_, i\) => i !== index\) \}\)/,
  "removing an attachment PATCHes the filtered array",
);
assert.match(src, /aria-label=\{`Remove \$\{att\.name\}`\}/, "each attachment's remove button is named for its file");
assert.match(src, /disabled=\{busy \|\| atCap\}/, "the add-files button is disabled while busy or at the 10-file cap");

// ── Drop-to-attach mirrors the home composer's guarded drag handling ─────────
assert.match(
  src,
  /if \(!hasDraggedFiles\(e\.dataTransfer\.types\)\) return;[\s\S]*?e\.preventDefault\(\);[\s\S]*?e\.stopPropagation\(\);[\s\S]*?if \(busy \|\| atCap\) return;[\s\S]*?dragDepthRef\.current \+= 1;/,
  "drag-enter prevents browser navigation for file drags but only arms when not busy or at the cap",
);
assert.match(
  src,
  /onDragOver=\{\(e\) => \{[\s\S]*?if \(!hasDraggedFiles\(e\.dataTransfer\.types\)\) return;[\s\S]*?e\.preventDefault\(\);[\s\S]*?e\.stopPropagation\(\);[\s\S]*?if \(busy \|\| atCap\) return;/,
  "drag-over prevents browser navigation for file drags even while busy or capped",
);
assert.match(
  src,
  /onDragLeave=\{\(e\) => \{[\s\S]*?if \(!hasDraggedFiles\(e\.dataTransfer\.types\)\) return;[\s\S]*?e\.stopPropagation\(\);[\s\S]*?dragDepthRef\.current = Math\.max\(0, dragDepthRef\.current - 1\);[\s\S]*?if \(dragDepthRef\.current === 0\) setDropActive\(false\);/,
  "drag-leave stops propagation and uses depth counting so crossing child elements doesn't flicker",
);
assert.match(
  src,
  /onDrop=\{\(e\) => \{[\s\S]*?if \(!hasDraggedFiles\(e\.dataTransfer\.types\)\) return;[\s\S]*?e\.preventDefault\(\);[\s\S]*?e\.stopPropagation\(\);[\s\S]*?if \(busy \|\| atCap\) return;[\s\S]*?void addFiles\(e\.dataTransfer\.files\);/,
  "dropping files prevents browser navigation and routes through the same addFiles path only when enabled",
);

console.log("board-inspector-a11y.test.ts: ok");
