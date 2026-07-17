// @ts-nocheck
// Source pins for the chat composer footer band (cave-8eo2): the session's
// metadata — project · runtime/model · git context · linked tasks — rides a
// darker band attached to the composer panel's underside (the home composer's
// hc-footer-band grammar), moved OUT of the input's control row and the chat
// header so the write surface above stays a minimal box: textarea + attach /
// voice / Options on the left, enhance / send on the right.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

// ── The band is the panel's last section, after the control row ─────────────
assert.match(
  source,
  /className="cave-composer-controls"[\s\S]*?className="cave-composer-footer-band"/,
  "the footer band renders after the composer controls, inside the panel",
);

// ── Band contents: project · runtime · git on the left, tasks on the right ──
assert.match(
  source,
  /className="cave-composer-footer-band">\s*<div className="cave-composer-footer-band__context">\s*<ProjectPicker/,
  "the band's context cluster leads with the project picker",
);
assert.match(
  source,
  /<ProjectPicker\s*\n\s*projects=\{projects\}\s*\n\s*value=\{resolvedProjectId\}\s*\n\s*onChange=\{setProjectIdDraft\}\s*\n\s*allowNoProject/,
  "the project chip shows the RESOLVED selection (draft → task project → session cwd) and writes the draft",
);
assert.match(
  source,
  /createProject=\{createProject\}[\s\S]{0,200}?className="cave-chat-project-selector"/,
  "the project chip folds in the add-project flow (register + grant) like the home band",
);
assert.match(
  source,
  /className="cave-composer-footer-band__context">[\s\S]{0,900}?<ComposerRuntimeChip[\s\S]{0,900}?<ComposerGitChip projectRoot=\{activeProjectRoot\} onOpenUrl=\{onOpenUrl\} \/>/,
  "runtime/model and git context sit beside the project chip in the band",
);
assert.match(
  source,
  /className="cave-composer-footer-band">[\s\S]*?\{linkedContextRow\}\s*\n\s*<\/div>/,
  "the linked-context strip (tasks · GitHub · link/create) trails the band",
);

// ── The input box is minimal: no metadata chips in the utility row ───────────
const utilityRow = source.match(
  /className="cave-composer-utility-row">[\s\S]*?<\/div>\s*<div className="cave-composer-submit-row">/,
)?.[0] ?? "";
assert.ok(utilityRow, "chat composer utility row is present");
assert.doesNotMatch(
  utilityRow,
  /ComposerRuntimeChip|ComposerGitChip/,
  "the utility row carries no runtime/git metadata — attach · voice · Options only",
);

// ── The header no longer hosts the linked-context strip ─────────────────────
const header = source.match(/<header className="cave-chat-linear-header[\s\S]*?<\/header>/)?.[0] ?? "";
assert.ok(header, "chat header is present");
assert.doesNotMatch(
  header,
  /linkedContextRow/,
  "the header renders MetaLine only — the linked-context strip moved to the band",
);

// ── Band chrome: attached underside strip, one tone deeper ──────────────────
assert.match(
  css,
  /\.cave-composer-footer-band \{[\s\S]*?border-top: 1px solid var\(--border-hairline\);[\s\S]*?background: color-mix\(in oklch, var\(--bg-base\) 62%, transparent\);/,
  "the band is the darker hairline-topped strip clipped into the panel's bottom corners",
);
assert.match(
  css,
  /\.cave-composer-footer-band .cave-project-picker__trigger\.cave-chat-project-selector \{[\s\S]*?height: 30px;[\s\S]*?border-radius: var\(--radius-pill\);/,
  "the project chip matches the 30px pill family of the chips beside it",
);

// ── Reveal + mobile behavior ─────────────────────────────────────────────────
assert.match(
  css,
  /\.cave-composer-footer-band:hover \.cave-chat-linked-context \.cave-chat-linked-chip--link-task/,
  "the bare link-a-task affordance reveals on band hover (was header hover)",
);
assert.match(
  css,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-composer-footer-band,\s*\.cave-composer-footer-band__context \{\s*flex-wrap: wrap;/,
  "phone widths wrap the band's chips instead of crushing them",
);
// On phones the linked-context cluster stays hidden (class-wide rule) — the
// header's MobileHeaderTask chip carries the affiliation there.
assert.match(
  css,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-chat-meta-line,\s*\.cave-chat-linked-context \{\s*display: none;/,
  "mobile hides the band's linked-context cluster in favor of MobileHeaderTask",
);

console.log("chat-composer-footer-band.test.ts: ok");
