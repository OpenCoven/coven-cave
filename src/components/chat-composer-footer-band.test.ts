// @ts-nocheck
// Source pins for the chat composer's context grammar after the 2026-07-22
// split (cave-g21f) and the adaptive-placement refactor: context chips
// (ComposerContextChips — project · worktree · branch · model) are constructed once as
// chatContextControls and placed adaptively: footer-band cluster for new chats
// (inlineComposer), session-header div for active chats (!inlineComposer).
// The linked-work strip always lives in the footer band regardless of
// placement. The grouped ComposerActionsMenu keeps its four groups. The write
// surface stays minimal: textarea, then attach · voice · grouped menu · send.
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
assert.doesNotMatch(controlRow, /<ComposerContextChips/, "the context chips are placed adaptively (footer band for inlineComposer, session header for !inlineComposer) — never in the control row");
assert.doesNotMatch(controlRow, /<ComposerOptionsMenu/, "the composer actions should no longer expose the legacy options menu");
assert.doesNotMatch(source, /<ComposerLinkedWorkActions\b/, "ChatView should not mount the menu-row linked-work actions directly — the band uses the chip strip");

// ── The footer band is the panel's last section, after the control row ──────
assert.match(
  source,
  /className="cave-composer-control-row"[\s\S]*?className="cave-composer-footer-band"/,
  "the footer band renders after the composer controls, inside the panel",
);
// chatContextControls is constructed once with all runtime/model picker props preserved
assert.match(
  source,
  /const chatContextControls = \([\s\S]*?<ComposerContextChips[\s\S]*?runtime=\{modelHarness\}[\s\S]*?modelValue=\{composerModelValue\}[\s\S]*?onPickRuntime=\{handleSelectRuntime\}[\s\S]*?onPickModel=\{handleSelectModel\}/,
  "chatContextControls is constructed once as ComposerContextChips with preserved runtime/model picker props",
);
// New chats (inlineComposer): cluster mounts in footer band; active chats: session header
assert.match(
  source,
  /className="cave-composer-footer-band">[\s\S]*?\{inlineComposer \? \([\s\S]*?<div className="cave-composer-footer-band__cluster">[\s\S]*?\{chatContextControls\}[\s\S]*?<\/div>[\s\S]*?\) : null\}[\s\S]*?\{linkedContextRow\}[\s\S]*?<FollowUpCards/,
  "the band conditionally mounts the context cluster (inlineComposer only); linked work and follow-ups always follow",
);
assert.match(
  source,
  /cave-chat-header-context">\{chatContextControls\}/,
  "active chat mounts the context controls in the session header (.cave-chat-header-context)",
);
assert.doesNotMatch(
  source.match(/<footer[\s\S]*?className="cave-composer-shell"/)?.[0] ?? "",
  /cave-chat-followups/,
  "latest assistant options no longer float above the composer shell",
);

// ── Split chips (cave-g21f): project · worktree · branch · model as separate controls ──
assert.match(
  source,
  /<ComposerContextChips\s*\n\s*projects=\{projects\}\s*\n\s*projectValue=\{resolvedProjectId\}\s*\n\s*onProjectChange=\{setProjectIdDraft\}/,
  "the chips show the resolved authorized project selection and write the draft",
);
assert.doesNotMatch(
  source,
  /<ComposerContextChips[\s\S]{0,260}\ballowNoProject\b/,
  "the chat composer must not offer a project-free next turn",
);
assert.match(
  source,
  /createProject=\{createProject\}[\s\S]{0,600}?projectRoot=\{activeProjectRoot\}[\s\S]{0,120}?onOpenUrl=\{onOpenUrl\}/,
  "the chips fold in the add-project flow and the git/PR context (register + grant, branch, PR open)",
);
assert.match(
  source,
  /const composerPopoverPlacement = inlineComposer \? "bottom-start" : undefined;/,
  "brand-new inline composers prefer opening menus below while docked chats retain their existing placement",
);
assert.match(
  source,
  /<ComposerActionsMenu[\s\S]*?popoverPlacement: composerPopoverPlacement,[\s\S]*?\/>/,
  "the grouped actions receive the new-session placement",
);
assert.match(
  source,
  /<ComposerContextChips[\s\S]*?popoverPlacement=\{composerPopoverPlacement\}[\s\S]*?\/>/,
  "the individual context chips receive the new-session placement",
);
assert.match(
  source,
  /const composerAutocompletePosition = inlineComposer \? "top-full mt-2" : "bottom-full mb-2";[\s\S]*?cave-composer-popover absolute left-0 right-0 \$\{composerAutocompletePosition\}/,
  "inline slash and mention suggestions open below the composer too",
);
assert.doesNotMatch(
  source,
  /cave-composer-footer-band__context|<ProjectPicker\b|<ComposerRuntimeChip|<ComposerGitChip|<ComposerContextPill\b/,
  "neither the legacy picker cluster nor the combined pill render — the chips are the band's context grammar",
);

// ── Each chip opens its own picker; the hub popover is gone ─────────────────
// Grammar: Project > Worktree (conditional) > Branch > Model in control order
assert.match(
  pill,
  /aria-label=\{`Project: \$\{projectLabel\} — change project`\}[\s\S]*?aria-label=\{`Worktree: \$\{context\.worktree\} — open worktree actions`\}[\s\S]*?aria-label=\{`Branch: \$\{context\.branch\} — switch branch or create a worktree`\}[\s\S]*?aria-label=\{`Model: \$\{modelLabel\} — change model`\}/,
  "the chips read Project / Worktree / Branch / Model as separately labelled controls in order",
);
assert.match(pill, /const worktreeRef = useRef/, "worktree has its own independent ref anchor");
assert.match(pill, /const branchRef = useRef/, "branch has its own independent ref anchor");
assert.match(pill, /name="ph:tree-structure"/, "the worktree chip uses the tree-structure icon");
assert.doesNotMatch(
  pill,
  /aria-label=\{`Branch:[\s\S]{0,200}?context\.worktree[\s\S]{0,50}?`\}/,
  "worktree is no longer folded into the branch chip's accessible name",
);
assert.match(
  pill,
  /open=\{menu === "worktree"\}[\s\S]*?anchorRef=\{worktreeRef\}[\s\S]*?open=\{menu === "branch"\}[\s\S]*?anchorRef=\{branchRef\}/,
  "worktree and branch each have a separate GitBranchMenuPopover with its own open state and anchor",
);
assert.match(
  pill,
  /ComposerContextView\s*=\s*null\s*\|[\s\S]*?"worktree"/,
  "ComposerContextView supports the worktree picker state",
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
assert.match(
  pill,
  /placement=\{context\.config\.popoverPlacement\}/,
  "runtime and branch pickers honor the caller's preferred vertical side",
);

// ── Header: MetaLine + adaptive context controls (never linkedContextRow) ───
const header = source.match(/<header className="cave-chat-linear-header[\s\S]*?<\/header>/)?.[0] ?? "";
assert.ok(header, "chat header is present");
assert.doesNotMatch(
  header,
  /linkedContextRow/,
  "the header never carries the linked-context strip (that always stays in the band)",
);
// For active chats (!inlineComposer) the header hosts chatContextControls in
// .cave-chat-header-context; for new chats they move to the footer band.
assert.match(
  source,
  /!inlineComposer[\s\S]{0,200}cave-chat-header-context[\s\S]{0,200}\{chatContextControls\}/,
  "active chats (!inlineComposer) mount context controls in .cave-chat-header-context inside the header",
);
// Interactive controls must not be nested inside MetaLine's live region —
// the context div is placed *after* </MetaLine>, not inside it.
assert.doesNotMatch(
  source.match(/<MetaLine(?![A-Za-z])[\s\S]*?<\/MetaLine>/)?.[0] ?? "",
  /chatContextControls/,
  "chatContextControls is not nested inside MetaLine's live region",
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

// ── The reading measure stays on content while the composer uses the full dock
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
  /\.cave-chat-followups \{[\s\S]*flex:\s*0 0 100%;[\s\S]*border-top:\s*1px solid var\(--border-hairline\);/,
  "follow-up options should span the attached footer below its context row",
);
assert.match(
  transcriptCss,
  /\.cave-chat-linear \.cave-composer-shell \{[\s\S]*max-width:\s*100%;/,
  "composer shell should use the full dock width",
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
  transcriptCss,
  /\.cave-chat-linear \.cave-composer-footer-action,[\s\S]*?\.cave-chat-linear \.cave-composer-plus \{[\s\S]*?width:\s*var\(--space-6\);[\s\S]*?height:\s*var\(--space-6\);/,
  "in-chat Call and Add controls should use the compact 24px token",
);
assert.match(
  transcriptCss,
  /\.cave-chat-linear \.cave-composer-send \{[\s\S]*?width:\s*var\(--space-6\);[\s\S]*?height:\s*var\(--space-6\);/,
  "in-chat Send should use the compact 24px token",
);
assert.match(
  css,
  /\.cave-composer-send\[data-typing="true"\]\s*\{[\s\S]*?background:\s*color-mix\(in oklch, var\(--accent-presence\) 18%, transparent\);/,
  "typing should still add the accent tint fill to the send button",
);

// The busy/cancel circle paints its glyph ON the danger fill, so the only
// legible foreground is the on-danger token. `--danger-text` resolves to
// `var(--color-danger)` — red type meant for neutral surfaces — and painting
// the ✕ with it left a solid red square with no visible icon (cave-xrvns).
for (const [sheet, label] of [
  [css, "cave-composer.css"],
  [transcriptCss, "transcript.css"],
] as const) {
  const busy = sheet.match(/\.cave-composer-send--busy[^{]*\{[^}]*\}/g) ?? [];
  assert.ok(busy.length > 0, `${label} should style the busy send button`);
  for (const rule of busy) {
    assert.doesNotMatch(
      rule,
      /color:\s*var\(--danger-text\)/,
      `${label}: the busy glyph must not reuse --danger-text (same value as the danger fill)`,
    );
  }
  assert.ok(
    busy.some((rule) => /color:\s*var\(--color-danger-foreground\)/.test(rule)),
    `${label}: the busy glyph should use the on-danger foreground token`,
  );
}

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
  transcriptCss,
  /@media \(max-width: 767px\)[\s\S]*?\.cave-chat-linear \.cave-composer-footer-action,[\s\S]*?\.cave-chat-linear \.cave-composer-plus,[\s\S]*?\.cave-chat-linear \.cave-composer-send \{[\s\S]*?width:\s*var\(--touch-target\);[\s\S]*?height:\s*var\(--touch-target\);/,
  "chat-specific action sizing should restore mobile touch targets",
);
assert.match(
  css,
  /\.composer-options__choices\s*\{[\s\S]*?flex-wrap:\s*wrap/,
  "grouped choice panels wrap inside the popover rather than the composer footer",
);

console.log("chat-composer-footer-band.test.ts: ok");
