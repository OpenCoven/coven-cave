// @ts-nocheck
// Source pins for the chat composer's context grammar after the 2026-07-21
// "both" reconciliation (user call): the wide-column pass's footer band STAYS
// — context pill (project · runtime/model · git) left, linked-work strip
// (tasks · GitHub · link/create) right — AND the minimal-composer pass's
// grouped ComposerActionsMenu keeps all four groups (context · linked work ·
// improve · response), accepting the duplication. The write surface stays
// minimal: textarea, then attach · voice · grouped menu · circular send.
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

// ── The control row: attach · voice · grouped menu · send ───────────────────
const controlRowMatch = source.match(
  /<div className="cave-composer-control-row">[\s\S]*?<div className="cave-composer-submit-row">[\s\S]*?<\/div>\s*<\/div>/,
);
assert.ok(controlRowMatch, "expected the composer control row in ChatView");

const controlRow = controlRowMatch[0];

assert.match(
  controlRow,
  /aria-label="Attach images, videos, or files"[\s\S]*?aria-label="Voice call"[\s\S]*?<ComposerActionsMenu[\s\S]*?<div className="cave-composer-submit-row">[\s\S]*?aria-label="(?:Send message|Cancel response)"/,
  "the control row should keep direct attachment, direct Voice call, grouped ComposerActionsMenu, and then the submit control in order",
);
assert.doesNotMatch(controlRow, /<ComposerPlusMenu/, "the composer actions should no longer expose the legacy plus menu");
assert.doesNotMatch(controlRow, /<ComposerContextPill/, "the context pill lives in the footer band, not the control row");
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
  /className="cave-composer-footer-band">\s*\n\s*<ComposerContextPill[\s\S]*?\{linkedContextRow\}\s*\n\s*<\/div>/,
  "the band leads with the context pill, then the linked-context strip (tasks · GitHub · link/create)",
);

// ── The context pill folds project/runtime/git behind one control ───────────
assert.match(
  source,
  /<ComposerContextPill\s*\n\s*projects=\{projects\}\s*\n\s*projectValue=\{resolvedProjectId\}\s*\n\s*onProjectChange=\{setProjectIdDraft\}\s*\n\s*allowNoProject/,
  "the pill shows the RESOLVED project selection (draft → task project → session cwd) and writes the draft",
);
assert.match(
  source,
  /createProject=\{createProject\}[\s\S]{0,600}?projectRoot=\{activeProjectRoot\}[\s\S]{0,120}?onOpenUrl=\{onOpenUrl\}/,
  "the pill folds in the add-project flow and the git/PR context (register + grant, branch, PR open)",
);
assert.doesNotMatch(
  source,
  /cave-composer-footer-band__context|<ProjectPicker\b|<ComposerRuntimeChip|<ComposerGitChip/,
  "the band's old picker cluster is gone — project/runtime/git live behind the pill",
);

// ── The pill's hub popover has the three sections ───────────────────────────
assert.match(
  pill,
  /<PopoverLabel>Project<\/PopoverLabel>[\s\S]*?<PopoverLabel>Model<\/PopoverLabel>[\s\S]*?<PopoverLabel>Branch<\/PopoverLabel>/,
  "the pill's hub popover sections read Project / Model / Branch in order",
);
assert.match(
  pill,
  /hasGit \? \(/,
  "the Branch section elides for git-less composers (home, no-project chats)",
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

// ── Pill chrome: control radius, hairline border, quiet 6% text tint ────────
assert.match(
  css,
  /\.cave-context-pill \{[\s\S]{0,400}?height: 30px;[\s\S]{0,200}?border: 1px solid var\(--border-hairline\);\s*\n\s*border-radius: var\(--radius-control\);\s*\n\s*background: color-mix\(in oklch, var\(--text-primary\) 6%, transparent\);\s*\n\s*color: var\(--text-secondary\);\s*\n\s*font-size: var\(--text-sm\);/,
  "the context pill is the quiet 30px control-radius pill (hairline border, 6% text tint, 12px text token)",
);

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
  /className="cave-composer-footer-action focus-ring"[\s\S]*?<Icon name="ph:paperclip"[\s\S]*?className="cave-composer-footer-action focus-ring"[\s\S]*?<Icon name="ph:phone"/,
  "the direct attachment and Voice call buttons should share the compact footer action family",
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
