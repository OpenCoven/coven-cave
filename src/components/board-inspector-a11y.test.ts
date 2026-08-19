// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = [
  readFileSync(new URL("./board-inspector.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("./board-inspector-debug.tsx", import.meta.url), "utf8"),
].join("\n");

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

// ── Integrated Board Inspector stays decoupled from feature/library save UI ──
assert.doesNotMatch(src, /setSavedToLibrary|\/api\/library\/route-link|Save to Library/, "Library save badge flow stays out of the integrated inspector");

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

assert.match(
  src,
  /import\s*\{[^}]*\bopenExternalUrl\b[^}]*\}\s*from "@\/lib\/open-external"/,
  "inline PAT setup imports the shared URL opener",
);
assert.match(src, /onClick=\{\(\) => void openExternalUrl\(GITHUB_PAT_URL\)\}/, "inline PAT setup opens GitHub token creation outside the local app");
assert.match(src, /read:user,read:org,repo,notifications/, "inline PAT setup requests organization-read access for the GitHub organization filter");
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
  /onPatch\(card\.id, \{ ops: \{ attachmentOps: \[\{ op: "remove", name \}\] \} \}\)/,
  "removing an attachment sends an intent op (applied against the current card server-side)",
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

// ── Every stored card detail is reachable from the drawer (cave-9ex) ─────────
// Progressive disclosure must not become capability loss: lifecycle reason,
// retry counters, state-since stamp, and a raw-JSON debug view all live behind
// accessible drop-downs.
assert.match(src, /aria-expanded=\{lifecycleOpen\}/, "the Lifecycle disclosure exposes its expanded state");
assert.match(src, /aria-expanded=\{open\}[\s\S]*?Hide debug details/, "the Debug disclosure exposes its expanded state");
assert.match(src, /card\.lifecycleReason/, "the lifecycle drop-down surfaces the transition/failure reason");
assert.match(src, /retry \{card\.retryCount\}\/\{card\.maxRetries\}/, "retry progress is visible once a card has retried");
assert.match(src, /board-drawer-stamp-label">State since</, "the lifecycle drop-down stamps when the current state began");
assert.match(src, /JSON\.stringify\(card, null, 2\)/, "the full card JSON is available (and copyable) behind the Debug drop-down");
assert.match(src, /\["cwd", card\.cwd \?\? "—"\]/, "debug rows include the working directory");
assert.match(src, /\["session", card\.sessionId \?\? "—"\]/, "debug rows include the linked session id");

// ── Governed agentic Enhance stays opt-in and routes every mutation through
// the Board contract rather than an optimistic client patch. ──────────────────
assert.match(
  src,
  /import \{ caveAgenticRecommendations \} from "@\/lib\/feature-flags"/,
  "Board Enhance checks the disabled-by-default agentic capability",
);
assert.match(
  src,
  /function BoardAgenticEnhanceSection\(/,
  "the inspector owns the governed Board Enhance review surface",
);
assert.match(
  src,
  /"x-coven-cave-intent": "board-agentic-enhance"/,
  "Enhance mutations carry the route's governed intent",
);
assert.match(
  src,
  /fetch\(`\/api\/board\/\$\{card\.id\}\/enhance`/,
  "apply, dismiss, and revert use the governed Board Enhance route",
);
assert.match(
  src,
  /contextFingerprint: proposal\?\.context\.fingerprint/,
  "proposal mutations send the current persisted context fingerprint",
);
assert.match(
  src,
  /onCardReplaced\(body\.card as Card\)/,
  "the persisted route response replaces the local card instead of applying a client patch",
);
assert.match(
  src,
  /Human authorship conflict/,
  "human-authored orchestration conflicts are named in the review UI",
);
assert.match(
  src,
  /Enhance does not dispatch or transition this task\./,
  "approval-bound proposals make the no-dispatch boundary explicit",
);
assert.match(
  src,
  /moves\.filter\(\(move\) => move\.to !== "dispatched"\)/,
  "approval-bound work hides dispatch without suppressing recovery or cancellation",
);
assert.doesNotMatch(
  src,
  /card\.needsHuman === true[\s\S]{0,400}availableMoves/,
  "generic needs-human attention does not suppress lifecycle recovery controls",
);
assert.match(
  src,
  /void mutate\("generate"\)/,
  "an empty review can explicitly request governed Board recommendations",
);
assert.match(
  src,
  /intent: "generate"/,
  "generation uses the Board backend's generate intent rather than client-authored output",
);
assert.doesNotMatch(
  src,
  /EMPTY_AGENTIC_RECOMMENDATIONS_OUTPUT|recommendations: \[\]/,
  "the UI never sends empty recommendation output as a fake generation result",
);
assert.match(
  src,
  /setOpen\(true\);[\s\S]{0,160}void mutate\("generate"\)/,
  "the review panel opens before generation so failures remain visible",
);
assert.match(
  src,
  /Regenerate recommendations/,
  "persisted recommendations retain an independent regeneration action",
);
assert.match(
  src,
  /aria-label="Enhance actions"/,
  "generation and review controls remain independently addressable",
);
assert.match(
  src,
  /mutationSequenceRef/,
  "proposal mutations carry a monotonic sequence for stale response safety",
);
assert.match(
  src,
  /sequence !== mutationSequenceRef\.current/,
  "an older mutation response is ignored after a newer request supersedes it",
);
assert.match(
  src,
  /proposalDisplayPatch/,
  "blocked replacement proposals still render a review-only patch diff",
);
assert.match(src, /function isRecord\(/, "proposal display values are narrowed before reading fields");
assert.match(src, /Invalid dependency:/, "malformed blocked dependencies render safely");
assert.match(src, /Invalid GitHub reference:/, "malformed blocked GitHub references render safely");
assert.doesNotMatch(
  src,
  /payload\.patch as BoardAgenticPatch/,
  "blocked payload patches are never unsafely cast to the trusted patch type",
);
assert.match(
  src,
  />Current</,
  "proposal diffs expose the current task value",
);
assert.match(
  src,
  />Proposed</,
  "proposal diffs expose the proposed task value",
);
assert.match(
  src,
  /Added|Removed/,
  "collection diffs call out additions and removals",
);
for (const field of [
  "primaryBlockerPinned",
  "actorFamiliarId",
  "capability",
  "target",
  "inputs",
  "taskId",
  "reference",
  "state",
  "kind",
  "label",
]) {
  assert.match(src, new RegExp(field), `proposal diffs expose routing field "${field}"`);
}
assert.match(
  src,
  /primaryLabel\(card\.primaryBlockerId, currentDependencies\)/,
  "primary blocker diffs resolve current values through stable dependency identity",
);
assert.match(
  src,
  /useAnnouncer\(\)/,
  "agentic proposal mutations are announced through the shared live region",
);

console.log("board-inspector-a11y.test.ts: ok");
