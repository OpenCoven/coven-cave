import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RESEARCH_GENERATION_KINDS,
  RESEARCH_GENERATION_MEDIA_KINDS,
  RESEARCH_GENERATION_STATUSES,
} from "../../lib/research-generations.ts";

const tab = readFileSync(new URL("./research-tab-studio.tsx", import.meta.url), "utf8");
const modals = readFileSync(new URL("./research-studio-modals.tsx", import.meta.url), "utf8");
const css = readFileSync(
  new URL("../../styles/globals/surface-research-studio.css", import.meta.url),
  "utf8",
);
const source = `${tab}\n${modals}`;

test("media kinds render disabled from RESEARCH_GENERATION_MEDIA_KINDS — one source of truth", () => {
  // Cards are mapped from the lib constant, not hand-copied.
  assert.match(tab, /RESEARCH_GENERATION_MEDIA_KINDS\.map/);
  // Non-interactive, told to AT, hint visible on the card itself.
  assert.match(tab, /aria-disabled="true"/);
  assert.match(tab, /\{media\.hint\}/);
  assert.match(tab, /\{media\.label\}/);
  // The honest hint text lives in the lib only — no duplicated copies here.
  for (const media of RESEARCH_GENERATION_MEDIA_KINDS) {
    assert.doesNotMatch(source, new RegExp(media.hint.slice(0, 20)));
  }
  // Media cards are never buttons and never reach the create path.
  assert.doesNotMatch(source, /kind:\s*"(podcast|short-video|long-video)"/);
  // Presentation map covers exactly the lib's media kinds.
  for (const media of RESEARCH_GENERATION_MEDIA_KINDS) {
    assert.match(modals, new RegExp(`["']?${media.kind}["']?:\\s*\\{ glyph:`));
  }
});

test("create failures surface the server's message inline (409 no-artifact included)", () => {
  assert.match(tab, /setCreateError\(result\.error \?\? "Generation failed"\)/);
  assert.match(modals, /role="alert"/);
  assert.match(modals, /\{error\}/);
  // The chips only offer missions the server would draft from — mirroring the
  // published-or-working markdown artifact rule.
  assert.match(modals, /endsWith\("\.md"\)/);
  assert.match(modals, /artifact\.state === "published" \|\| artifact\.state === "working"/);
});

test("markdown editor never fakes persistence", () => {
  // The backend exposes list/create/remove only — no update fetcher — so the
  // primary action is clipboard, plainly labeled, with the gap stated.
  assert.match(modals, /Copy updated draft/);
  assert.match(modals, /drafts save back when\s+generation editing lands/);
  assert.doesNotMatch(source, /✓ Saved/);
  assert.doesNotMatch(source, /Save draft/);
  assert.doesNotMatch(source, /method:\s*"(PATCH|PUT)"/);
  // Rich mode is a read-only preview of the markdown source of truth — no
  // editable-DOM path exists (comments may mention the rejected approach).
  assert.doesNotMatch(source, /document\.execCommand|contentEditable=/);
});

test("statuses are terminal — load on mount + after mutations, no polling", () => {
  assert.equal(RESEARCH_GENERATION_STATUSES.length, 3);
  assert.match(tab, /listResearchGenerations/);
  assert.doesNotMatch(source, /setInterval/);
  assert.doesNotMatch(source, /usePausablePoll/);
  // And no fake progress affordances for synchronous drafting (prose may
  // mention the rejected design; markup must not render one).
  assert.doesNotMatch(source, /<progress|role="progressbar"|__progress/);
});

test("copy flash is a 1200ms label swap — reduced-motion safe", () => {
  assert.match(modals, /COPY_FLASH_MS = 1200/);
  assert.match(modals, /setTimeout\(/);
  // Pure label swap: no animation frames drive the flash.
  assert.doesNotMatch(source, /requestAnimationFrame/);
  // The CSS layer zeroes its transitions for reduced-motion users.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /prefers-reduced-motion[\s\S]*transition: none/);
});

test("modals trap focus, restore on close, Esc + backdrop close, announce open", () => {
  assert.match(modals, /useFocusTrap\(true, dialogRef, \{ onEscape: onClose \}\)/);
  assert.match(modals, /role="dialog"/);
  assert.match(modals, /aria-modal="true"/);
  assert.match(modals, /tabIndex=\{-1\}/);
  assert.match(modals, /onClick=\{onClose\}/); // backdrop click closes
  assert.match(modals, /stopPropagation\(\)/); // dialog clicks don't
  assert.match(modals, /useAnnouncer/);
  assert.match(modals, /announce\(announceText\)/);
  // All three dialogs go through the shared shell.
  for (const variant of ["config", "viewer", "editor"]) {
    assert.match(modals, new RegExp(`variant="${variant}"`));
  }
});

test("filter chips cover only kinds that can exist, with real counts", () => {
  // Chips map from the creatable union; counts come from the loaded list.
  assert.match(tab, /RESEARCH_GENERATION_KINDS\.map\(\(kind\) => \(\s*<button/);
  assert.match(tab, /generations\.filter\(\(generation\) => generation\.kind === kind\)\.length/);
  // No Podcast/Video filters — no such records can exist.
  assert.doesNotMatch(tab, /All.*Podcast|"Video"/);
  assert.equal(RESEARCH_GENERATION_KINDS.length, 5);
  // Empty kinds can't be selected into a dead-end view.
  assert.match(tab, /disabled=\{\(counts\.get\(kind\) \?\? 0\) === 0\}/);
});

test("per-kind actions stay honest: mermaid inline + copy, open per kind, no fake exports", () => {
  assert.match(tab, /⌗ Hide Mermaid/);
  assert.match(tab, /⌗ View Mermaid/);
  assert.match(tab, /⧉ Copy Mermaid/);
  assert.match(tab, /↗ Open draft/);
  // Remove confirms inline — never a native confirm dialog.
  assert.match(tab, /Remove\?/);
  assert.doesNotMatch(source, /window\.confirm/);
  // Downloads are real Blob .md exports; no pdf/pptx/png promises anywhere.
  assert.match(modals, /Download \.md/);
  assert.match(modals, /new Blob\(\[markdown\], \{ type: "text\/markdown" \}\)/);
  assert.doesNotMatch(source, /Export (pptx|pdf|png|mp3|mp4)/i);
});
