// @ts-nocheck
// Source pins for the chat composer's context grammar after the 2026-07-22
// split (cave-g21f): the footer band carries project · model · branch as
// three separate chips (ComposerContextChips) on the left — each opening its
// own picker — and the linked-work strip (tasks · GitHub · link/create) on
// the right. The grouped ComposerActionsMenu keeps its four groups. The
// write surface stays minimal: textarea, then attach · voice · grouped menu ·
// circular send.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const source = read("./chat-view.tsx");
const pill = read("./composer-context-pill.tsx");
const activityCss = read("../styles/cave-chat/activity.css");
const transcriptCss = read("../styles/cave-chat/transcript.css");
const css = [
  "../styles/cave-composer.css",
  "../styles/cave-chat.css",
  "../styles/cave-chat/activity.css",
  "../styles/cave-chat/transcript.css",
]
  .map((sheet) => read(sheet))
  .join("\n");

// ── The control row: voice · grouped menu (attach folded inside) · send ─────
const controlRowMatch = source.match(
  /<div className="cave-composer-control-row">[\s\S]*?<div className="cave-composer-submit-row">[\s\S]*?<\/div>\s*<\/div>/,
);
assert.ok(controlRowMatch, "expected the composer control row in ChatView");

const controlRow = controlRowMatch[0];

assert.match(
  controlRow,
  /aria-label="Voice call"[\s\S]*?<ComposerActionsMenu[\s\S]*?<div className="cave-composer-submit-row">[\s\S]*?aria-label="(?:Send message|Cancel response)"/,
  "the control row should keep direct Voice call, grouped ComposerActionsMenu, and then the submit control in order",
);
assert.match(
  controlRow,
  /<ComposerActionsMenu\s*\n\s*attach=\{\{\s*\n\s*onSelect: \(\) => fileInputRef\.current\?\.click\(\)/,
  "attachment moved into the actions menu ('Add files or photos') — no standalone attach button",
);
assert.doesNotMatch(
  controlRow,
  /aria-label="Attach images, videos, or files"/,
  "the standalone attach button is gone from the control row (it lives in the + menu now)",
);
assert.doesNotMatch(controlRow, /<ComposerPlusMenu/, "the composer actions should no longer expose the legacy plus menu");
assert.doesNotMatch(controlRow, /<ComposerContextChips/, "the context chips live in the footer band, not the control row");
assert.doesNotMatch(controlRow, /<ComposerOptionsMenu/, "the composer actions should no longer expose the legacy options menu");
assert.doesNotMatch(source, /<ComposerLinkedWorkActions\b/, "ChatView should not mount the menu-row linked-work actions directly — the band uses the chip strip");

// ── The footer band is the panel's last section, after the control row ──────
assert.match(
  source,
  /className="cave-composer-control-row"[\s\S]*?className="cave-composer-footer-band"/,
  "the footer band renders after the composer controls, inside the panel",
);
assert.match(
  source,
  /className="cave-composer-footer-band">\s*\n\s*<div className="cave-composer-footer-band__cluster">\s*\n\s*<ComposerContextChips[\s\S]*?<\/div>\s*\n\s*\{linkedContextRow\}\s*\n\s*<\/div>/,
  "the band leads with the context-chips cluster, then the linked-context strip (tasks · GitHub · link/create)",
);

// ── Split chips (cave-g21f): project · model · branch as separate controls ──
assert.match(
  source,
  /<ComposerContextChips\s*\n\s*projects=\{projects\}\s*\n\s*projectValue=\{resolvedProjectId\}\s*\n\s*onProjectChange=\{setProjectIdDraft\}\s*\n\s*allowNoProject/,
  "the chips show the RESOLVED project selection (draft → task project → session cwd) and write the draft",
);
assert.match(
  source,
  /createProject=\{createProject\}[\s\S]{0,600}?projectRoot=\{activeProjectRoot\}[\s\S]{0,120}?onOpenUrl=\{onOpenUrl\}/,
  "the chips fold in the add-project flow and the git/PR context (register + grant, branch, PR open)",
);
assert.doesNotMatch(
  source,
  /cave-composer-footer-band__context|<ProjectPicker\b|<ComposerRuntimeChip|<ComposerGitChip|<ComposerContextPill\b/,
  "neither the legacy picker cluster nor the combined pill render — the chips are the band's context grammar",
);

// ── Each chip opens its own picker; the hub popover is gone ─────────────────
assert.match(
  pill,
  /aria-label=\{`Project: \$\{projectLabel\} — change project`\}[\s\S]*?aria-label=\{`Model: \$\{modelLabel\} — change model`\}[\s\S]*?aria-label=\{`Branch: \$\{context\.branch\} — switch branch or create a worktree`\}/,
  "the chips read Project / Model / Branch as separately labelled controls in order",
);
assert.match(pill, /context\.hasGit \? \(/, "the branch chip elides for git-less composers (home, no-project chats)");
assert.doesNotMatch(
  pill,
  /"hub"|<PopoverLabel>|ComposerContextActionRows|splitControls/,
  "the combined pill's hub popover, action rows, and the splitControls flag are retired",
);
assert.match(
  pill,
  /<GitBranchMenuPopover[\s\S]*?\{\.\.\.branchPopoverExtras\(context\)\}/,
  "the branch chip's menu carries the PR + Git-changes rows (hub parity)",
);

// ── The header no longer hosts the linked-context strip ─────────────────────
const header = source.match(/<header className="cave-chat-linear-header[\s\S]*?<\/header>/)?.[0] ?? "";
assert.ok(header, "chat header is present");
assert.doesNotMatch(
  header,
  /linkedContextRow/,
  "the header renders MetaLine only — the linked-context strip stays in the band",
);

// ── Band chrome: attached underside strip, one tone deeper ──────────────────
assert.match(
  css,
  /\.cave-composer-footer-band \{[\s\S]*?border-top: 1px solid var\(--border-hairline\);[\s\S]*?background: color-mix\(in oklch, var\(--bg-base\) 62%, transparent\);/,
  "the band is the darker hairline-topped strip clipped into the panel's bottom corners",
);

// ── Chip chrome: shared quiet 28px chips in the composer sheet ──────────────
assert.match(
  css,
  /\.cave-composer-footer-band__cluster \{[\s\S]{0,200}?min-width: 0;[\s\S]{0,120}?flex: 1 1 auto;/,
  "the band's chip cluster flexes and allows shrinking so three chips coexist with the linked strip",
);
assert.match(
  css,
  /\.cave-context-chip \{[\s\S]{0,400}?height: 28px;[\s\S]{0,300}?border-radius: var\(--radius-control\);\s*\n\s*background: transparent;\s*\n\s*color: var\(--text-secondary\);\s*\n\s*font-size: var\(--text-sm\);/,
  "the context chips are the quiet 28px control-radius family, defined in the shared composer sheet",
);
assert.match(
  css,
  /\.cave-context-chip\[aria-expanded="true"\] \{[\s\S]{0,200}?--accent-presence/,
  "an open chip shows the accent open-state (pill parity)",
);
assert.doesNotMatch(css, /\.cave-context-pill/, "the combined pill's CSS is retired with it");

// ── The wide reading measure: 64rem, shared by thread · follow-ups · composer
assert.match(
  activityCss,
  /\.cave-chat-linear \{[\s\S]*--cave-chat-measure:\s*64rem;/,
  "chat activity should define the shared wide-column 64rem measure token",
);
assert.match(
  activityCss,
  /\.cave-chat-linear \.cave-chat-thread \{[\s\S]*max-width:\s*var\(--cave-chat-measure\);/,
  "chat thread should cap itself with the shared measure token",
);
assert.match(
  transcriptCss,
  /\.cave-chat-followups \{[\s\S]*max-width:\s*var\(--cave-chat-measure\);/,
  "follow-up pills should share the chat reading measure token",
);
assert.match(
  transcriptCss,
  /\.cave-chat-linear \.cave-composer-shell \{[\s\S]*max-width:\s*var\(--cave-chat-measure\);/,
  "composer shell should share the chat reading measure token",
);

// ── Footer action family + circular send ────────────────────────────────────
assert.match(
  controlRow,
  /className="cave-composer-footer-action focus-ring"[\s\S]*?<Icon name="ph:phone"/,
  "the direct Voice call button should keep the compact footer action family",
);
assert.match(
  css,
  /\.cave-composer-footer-action\s*\{[\s\S]*?width:\s*30px;[\s\S]*?height:\s*30px;/,
  "footer actions should use the 30px resting-control family",
);
assert.match(
  css,
  /\.cave-composer-send\s*\{[\s\S]*?width:\s*32px;[\s\S]*?height:\s*32px;[\s\S]*?border:\s*1px solid var\(--accent-presence\);[\s\S]*?border-radius:\s*var\(--radius-pill\);[\s\S]*?background:\s*transparent;/,
  "send should remain the circular 32px accent-outline button",
);
assert.match(
  css,
  /\.cave-composer-send\[data-typing="true"\]\s*\{[\s\S]*?background:\s*color-mix\(in oklch, var\(--accent-presence\) 18%, transparent\);/,
  "typing should still add the accent tint fill to the send button",
);

// The "↵ send · ⇧↵ newline" typing hint is gone from the chat composer
// (2026-07-21): the tinted send button already signals sendability. The
// home composer dropped its hint in the same day's parity pass, so the
// shared CSS class is retired with its last consumer.
assert.doesNotMatch(
  source,
  /cave-composer-typing-hint/,
  "the enter-to-send typing hint no longer renders in the chat composer",
);
assert.doesNotMatch(
  css,
  /cave-composer-typing-hint/,
  "the typing-hint CSS is retired with its last consumer (the home composer)",
);

// ── Reveal + mobile behavior ─────────────────────────────────────────────────
assert.match(
  css,
  /\.cave-composer-footer-band:hover \.cave-chat-linked-context \.cave-chat-linked-chip--link-task/,
  "the bare link-a-task affordance reveals on band hover",
);
// On phones the linked-context cluster stays hidden (class-wide rule) — the
// header's MobileHeaderTask chip carries the affiliation there.
assert.match(
  css,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-chat-meta-line,\s*\.cave-chat-linked-context \{\s*display: none;/,
  "mobile hides the band's linked-context cluster in favor of MobileHeaderTask",
);
assert.match(
  css,
  /@media \(max-width: 767px\)[\s\S]*?\.cave-composer-footer-action,[\s\S]*?\.cave-composer-plus,[\s\S]*?\.cave-composer-send\s*\{[\s\S]*?width:\s*var\(--touch-target\);/,
  "footer actions, plus, and send should all grow to the mobile touch target",
);
assert.match(
  css,
  /\.composer-options__choices\s*\{[\s\S]*?flex-wrap:\s*wrap/,
  "grouped choice panels wrap inside the popover rather than the composer footer",
);

console.log("chat-composer-footer-band.test.ts: ok");
