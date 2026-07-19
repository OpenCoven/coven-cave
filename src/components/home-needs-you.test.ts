// @ts-nocheck
// cave-925w — morning triage, folded into the digest carousel. Pins:
// (1) the needs-you tier surfaces as warning-tinted cards leading the chats
// track, each one click from its target, (2) overflow collapses into a
// "+N more" card that jumps to Schedules, (3) the carousel and the Schedules
// nav badge share ONE groupInboxFeed memo so they can never disagree, and
// (4) the quick-action suggestions ride the same track (two carousels total).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const carousel = await readFile(new URL("./home/home-digest-carousel.tsx", import.meta.url), "utf8");
const digest = await readFile(new URL("../lib/home-digest.ts", import.meta.url), "utf8");
const composer = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/home-composer.css", import.meta.url), "utf8");

// ── Phase 3: one source of truth ──────────────────────────────────────────────
assert.match(
  workspace,
  /const inboxNeedsYou = useMemo\(\s*\(\) => groupInboxFeed\(inboxItemsWithEphemeral\)\.needsYou,/,
  "workspace computes the needs-you tier once",
);
assert.match(
  workspace,
  /const scheduleNeedsCount = inboxNeedsYou\.length;/,
  "the Schedules nav badge derives from that same memo",
);
assert.match(workspace, /needsYou=\{inboxNeedsYou\}/, "Home receives the same group, not a copy");

// ── Rows reuse existing plumbing ──────────────────────────────────────────────
assert.match(
  workspace,
  /needsYou=\{inboxNeedsYou\}\s*onOpenInboxItem=\{openInspectorInboxItem\}/,
  "needs-you cards open items through the same handler the bell popover uses",
);
assert.match(
  workspace,
  /onOpenSchedules=\{\(\) => setMode\("inbox"\)\}/,
  "the overflow affordance jumps to the Schedules surface",
);

// ── Folded into the hearth card's Open work section (chat revamp 1a) ─────────
// The digest carousel is hidden from the default home; the needs-you tier now
// surfaces as an Open work row, one click from its target (single item) or
// from Rituals (several). Suggestions insert through the demoted pill row.
assert.match(
  composer,
  /<HomeOpenWork[\s\S]*?needsYou=\{needsYou\}[\s\S]*?onOpenInboxItem=\{onOpenInboxItem\}[\s\S]*?onOpenSchedules=\{onOpenSchedules\}/,
  "home forwards the needs-you tier into the Open work section",
);
assert.match(
  composer,
  /<HomeSuggestionPills[\s\S]*?onPick=\{insertPrompt\}/,
  "suggestion picks insert into the composer (never auto-send)",
);
assert.doesNotMatch(composer, /HomeNeedsYou|HomeSuggestions\b/, "the standalone strips stay gone");
assert.match(digest, /kind: "needs"/, "the digest builder emits needs-you cards");
assert.match(digest, /kind: "suggestion"/, "the digest builder emits quick-action suggestion cards");
assert.match(digest, /"Waiting on you"/, "response-needed cards say so instead of a timestamp");
assert.match(carousel, /home-digest__card--needs/, "needs-you cards render with their own tint class");
assert.match(carousel, /home-digest__card--suggestion/, "suggestion cards render with their own tint class");
assert.match(carousel, /onOpenSchedules\?\.\(\)/, "the +N more card opens Schedules");
assert.match(carousel, /\+\{card\.count\} more/, "overflow collapses into a +N more card");
assert.match(carousel, /onOpenInboxItem\?\.\(card\.item\)/, "a needs card opens its inbox item's target");
assert.match(carousel, /onPickSuggestion\?\.\(card\.prompt\)/, "a suggestion card inserts its prompt (never auto-sends)");

// ── Colors — attention reads warning, quick actions read presence ────────────
assert.match(
  css,
  /\.home-digest__card--needs \{[\s\S]{0,300}?--color-warning\) 30%, var\(--border-hairline\)/,
  "needs tint follows the design-language recipe (30% warning border)",
);
assert.match(
  css,
  /\.home-digest__card--needs \.home-digest__icon \{\s*color: var\(--color-warning\);/,
  "needs card icon carries the solid warning tint",
);
assert.match(
  css,
  /\.home-digest__card--suggestion \{[\s\S]{0,300}?--accent-presence\)/,
  "suggestion cards carry the presence tint",
);
assert.doesNotMatch(css, /\.home-needs-you|\.home-suggestion-pill/, "the dead strip CSS is removed");

console.log("home-needs-you.test.ts: ok");
