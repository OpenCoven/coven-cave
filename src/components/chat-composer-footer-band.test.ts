// @ts-nocheck
// Source pins for the chat composer's context grammar (2026-07-21 wide-column
// pass, superseding chat revamp 1d's control-row pill): the session's project ·
// runtime/model · git context stays ONE quiet context pill, but it lives in
// the footer band alongside the linked-work strip (tasks · GitHub ·
// link/create). The utility cluster stays collapsed into ONE "+" menu, and
// the write surface stays minimal: textarea + "+" · circular send.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const pill = readFileSync(new URL("./composer-context-pill.tsx", import.meta.url), "utf8");
const css = ["cave-md", "cave-composer", "chat-list", "calendar", "cave-chat"]
  .map((sheet) => readFileSync(new URL(`../styles/${sheet}.css`, import.meta.url), "utf8"))
  .join("\n");

// ── The band is the panel's last section, after the control row ─────────────
assert.match(
  source,
  /className="cave-composer-controls"[\s\S]*?className="cave-composer-footer-band"/,
  "the footer band renders after the composer controls, inside the panel",
);

// ── Band contents: the context pill + the linked-work strip ─────────────────
assert.match(
  source,
  /className="cave-composer-footer-band">\s*\n\s*<ComposerContextPill[\s\S]*?\{linkedContextRow\}\s*\n\s*<\/div>/,
  "the band leads with the context pill, then the linked-context strip (tasks · GitHub · link/create)",
);

// ── The context pill replaces the band's picker cluster ─────────────────────
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

// ── The utility row is just "+" — the pill lives in the band ────────────────
const utilityRow = source.match(
  /className="cave-composer-utility-row">[\s\S]*?<div className="cave-composer-submit-row">/,
)?.[0] ?? "";
assert.ok(utilityRow, "chat composer utility row is present");
assert.match(
  utilityRow,
  /<ComposerPlusMenu/,
  "the utility row leads with the + menu",
);
assert.doesNotMatch(
  utilityRow,
  /<ComposerContextPill/,
  "the context pill moved down to the footer band (2026-07-21 wide-column pass)",
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
assert.match(
  css,
  /\.cave-composer-plus\[aria-expanded="true"\] \{[\s\S]*?border-color: var\(--accent-presence\);[\s\S]*?background: color-mix\(in oklch, var\(--accent-presence\) 12%, transparent\);/,
  "the + trigger highlights (accent border + ~12% tint) while its popover is open",
);
assert.match(
  css,
  /\.cave-composer-send \{[\s\S]*?width: 32px;[\s\S]*?height: 32px;[\s\S]*?border: 1px solid var\(--accent-presence\);[\s\S]*?border-radius: var\(--radius-pill\);[\s\S]*?background: transparent;/,
  "send is the circular 32px accent-outline button",
);
assert.match(
  css,
  /\.cave-composer-send\[data-typing="true"\] \{\s*\n\s*background: color-mix\(in oklch, var\(--accent-presence\) 18%, transparent\);/,
  "typing adds the ~18% accent tint fill to send",
);
// The "↵ send · ⇧↵ newline" typing hint is gone from the chat composer
// (2026-07-21): the tinted send button already signals sendability. The
// home composer keeps its own hint, so the shared CSS class stays.
assert.doesNotMatch(
  source,
  /cave-composer-typing-hint/,
  "the enter-to-send typing hint no longer renders in the chat composer",
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

console.log("chat-composer-footer-band.test.ts: ok");
