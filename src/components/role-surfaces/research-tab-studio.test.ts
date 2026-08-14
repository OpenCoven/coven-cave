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

test("media cards use one source of truth and gate on live readiness", () => {
  assert.match(tab, /RESEARCH_GENERATION_CREATABLE_KINDS\.map/);
  assert.match(tab, /getResearchGenerationReadiness/);
  assert.match(tab, /disabled=\{sources\.length === 0 \|\| !mediaReady\}/);
  assert.match(tab, /readiness\?\.podcast\.hint/);
  assert.doesNotMatch(tab, /aria-disabled="true"/);
  // Presentation map covers exactly the lib's media kinds.
  for (const media of RESEARCH_GENERATION_MEDIA_KINDS) {
    assert.match(modals, new RegExp(`["']?${media.kind}["']?:\\s*\\{ glyph:`));
  }
});

test("media configuration is controlled, readiness-backed, and kind-specific", () => {
  assert.match(tab, /useState<ResearchMediaProvider>\("local"\)/);
  assert.match(tab, /useState<ResearchMediaLength>\("standard"\)/);
  assert.match(tab, /readiness\.providers\.local\.voices/);
  assert.match(tab, /readiness\.providers\.elevenlabs\.defaultVoiceId/);
  assert.match(tab, /renderConfig:\s*\{[\s\S]*provider: mediaProvider,[\s\S]*voice: mediaVoice,[\s\S]*length: mediaLength/);
  assert.match(modals, /htmlFor="research-studio-config-provider"/);
  assert.match(modals, /id="research-studio-config-provider"/);
  assert.match(modals, /readiness\.providers\.local\.ready/);
  assert.match(modals, /readiness\.providers\.elevenlabs\.ready/);
  assert.match(modals, /htmlFor="research-studio-config-local-voice"/);
  assert.match(modals, /readiness\?\.providers\.local\.voices\.map/);
  assert.match(modals, /htmlFor="research-studio-config-elevenlabs-voice"/);
  assert.match(modals, /readiness\?\.providers\.elevenlabs\.defaultVoiceId/);
  assert.match(modals, /htmlFor="research-studio-config-length"/);
  assert.match(modals, /kind !== "short-video"/);
  assert.match(modals, /aria-describedby="research-studio-config-provider-help"/);
  assert.match(modals, /aria-describedby="research-studio-config-voice-help"/);
  assert.match(modals, /aria-describedby="research-studio-config-length-help"/);
});

test("media drafts reopen review and retry creates a replacement draft", () => {
  assert.match(tab, /generation\.status === "draft"/);
  assert.match(tab, />\s*Review draft\s*</);
  assert.match(tab, /\.\.\.\(generation\.renderConfig \? \{ renderConfig: generation\.renderConfig \} : \{\}\)/);
  assert.match(tab, /setReviewGeneration\(result\.generation\)/);
  assert.match(tab, /announce\(`\$\{studioMetaForKind\(generation\.kind\)\.label\} draft ready for review`\)/);
  assert.doesNotMatch(tab, /retry queued/);
});

test("media lifecycle text, cancellation, players, and download use persisted state", () => {
  assert.match(modals, /if \(generation\.status === "queued"\) return "Waiting to render"/);
  assert.match(modals, /Chapter \$\{generation\.progress\.current\} of \$\{generation\.progress\.total\}/);
  assert.match(modals, /Scripting|Synthesizing|Encoding/);
  assert.match(tab, /result\.generation/);
  assert.doesNotMatch(tab, /\{ \.\.\.entry, status: "cancelled"/);
  assert.match(modals, /<audio[\s\S]*controls[\s\S]*preload="metadata"/);
  assert.match(modals, /<video[\s\S]*controls[\s\S]*preload="metadata"/);
  assert.match(modals, /download=1/);
});

test("create failures surface the server's message inline (409 no-artifact included)", () => {
  assert.match(tab, /setCreateError\(result\.error \?\? "Generation failed"\)/);
  assert.match(modals, /role="alert"/);
  assert.match(modals, /\{error\}/);
  // The source dropdown only offers missions the server would draft from —
  // mirroring the published-or-working markdown artifact rule.
  assert.match(modals, /endsWith\("\.md"\)/);
  assert.match(modals, /artifact\.state === "published" \|\| artifact\.state === "working"/);
});

test("generation directions show a bounded, quiet character count", () => {
  assert.match(modals, /maxLength=\{RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH\}/);
  assert.match(modals, /directions\.length\.toLocaleString\(\)\} \/ \{RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH\.toLocaleString\(\)/);
  assert.doesNotMatch(modals, /research-studio-config__count" aria-live/);
  assert.match(css, /\.research-studio-config__count--near/);
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

test("Studio polls only while an async media row is active", () => {
  assert.equal(RESEARCH_GENERATION_STATUSES.length, 6);
  assert.match(tab, /listResearchGenerations/);
  assert.match(source, /usePausablePoll/);
  assert.match(source, /1_500/);
  assert.match(tab, /listInFlightRef\.current/);
  assert.match(tab, /void loadGenerations\(false\)/);
  assert.doesNotMatch(tab, /setReloadTick/);
  assert.match(source, /queued[\s\S]*rendering|rendering[\s\S]*queued/);
  assert.match(source, /cancelResearchGeneration/);
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

test("copy goes through lib/clipboard's copyText — works in the Tauri webview", () => {
  // navigator.clipboard is undefined outside secure contexts (packaged Tauri,
  // plain-http LAN) — copyText falls back to execCommand and reports success,
  // so the ✓ flash only shows when the copy actually landed.
  assert.match(modals, /import \{ copyText \} from "@\/lib\/clipboard"/);
  assert.match(modals, /const ok = await copyText\(text\)/);
  assert.doesNotMatch(source, /navigator\.clipboard\.writeText/);
});

test("modals trap focus, restore on close, Esc + backdrop close, announce open", () => {
  assert.match(modals, /useFocusTrap\(active, dialogRef, \{ onEscape: onClose \}\)/);
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

test("stacked viewer+editor keep exactly one live focus trap (active gating)", () => {
  // StudioModal exposes `active` (default true) and feeds it to useFocusTrap
  // as the enable flag — an inactive dialog has no Tab cycle and no Escape
  // handler, so Escape closes only the top (editor) dialog, not both.
  assert.match(modals, /active\?: boolean/);
  assert.match(modals, /active = true/);
  assert.match(modals, /useFocusTrap\(active, dialogRef/);
  // The parked dialog is also hidden from AT and input — no second
  // aria-modal sibling in the accessibility tree while stacked.
  assert.match(modals, /aria-hidden=\{active \? undefined : true\}/);
  assert.match(modals, /inert=\{!active \|\| undefined\}/);
  // The viewer forwards the flag to the shared shell…
  assert.match(modals, /active=\{active\}/);
  // …and the studio parks the viewer exactly while the editor is stacked.
  assert.match(tab, /active=\{editorGeneration === null\}/);
});

test("filter chips cover only kinds that can exist, with real counts", () => {
  // Chips map from the creatable union; counts come from the loaded list.
  assert.match(tab, /RESEARCH_GENERATION_CREATABLE_KINDS\.map\(\(kind\) => \(\s*<button/);
  assert.match(tab, /generations\.filter\(\(generation\) => generation\.kind === kind\)\.length/);
  // Media filters exist once records can exist.
  assert.match(tab, /RESEARCH_GENERATION_CREATABLE_KINDS/);
  assert.equal(RESEARCH_GENERATION_KINDS.length, 5);
  // Empty kinds can't be selected into a dead-end view.
  assert.match(tab, /disabled=\{\(counts\.get\(kind\) \?\? 0\) === 0\}/);
});

test("per-kind actions stay honest: diagram renders + copy, open per kind, no fake exports", () => {
  assert.match(tab, /◇ Hide diagram/);
  assert.match(tab, /◇ View diagram/);
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

test("diagrams render through the chat mermaid pipeline, source stays inspectable", () => {
  // One shared renderer: StudioMermaidDiagram wraps MarkdownBlock with a
  // ```mermaid fence, so the Studio inherits the chat pipeline (sanitized
  // SVG, theme-aware, expand-to-fullscreen wiring) instead of a raw <pre>.
  assert.match(modals, /function StudioMermaidDiagram/);
  assert.match(modals, /```mermaid/);
  assert.match(modals, /<MarkdownBlock/);
  // Row toggle and viewer modal both render the diagram…
  assert.match(tab, /<StudioMermaidDiagram mermaid=\{mermaid\} \/>/);
  assert.match(modals, /<StudioMermaidDiagram mermaid=\{content\.mermaid\} \/>/);
  // …and the viewer keeps the mermaid source readable under a disclosure.
  assert.match(modals, /Mermaid source/);
  assert.match(modals, /research-studio-viewer__code-details/);
});

test("source runs pick from a labelled dropdown — tab and config modal", () => {
  // Tab-level picker: a real <select> with a visible label, valued by mission
  // id, listing only qualifying sources.
  assert.match(tab, /htmlFor="research-studio-source"/);
  assert.match(tab, /id="research-studio-source"/);
  assert.match(tab, /className="research-studio__select"/);
  assert.match(tab, /\{sources\.map\(\(source\) => \(\s*<option/);
  // Config modal mirrors it (same class, own id + label).
  assert.match(modals, /htmlFor="research-studio-config-source"/);
  assert.match(modals, /id="research-studio-config-source"/);
  // Sources are no longer chip buttons anywhere.
  assert.doesNotMatch(source, /research-studio__chip"[\s\S]{0,120}aria-pressed/);
});

test("thread viewer shows each post's length against the shared budget", () => {
  // The 280 budget lives in the lib (server clamps with it; viewer counts
  // with it) — no magic numbers in the surface.
  assert.match(modals, /RESEARCH_THREAD_POST_MAX_CHARS/);
  assert.match(modals, /\$\{post\.text\.length\}\/\$\{RESEARCH_THREAD_POST_MAX_CHARS\}/);
  assert.doesNotMatch(source, /\/280/);
});

test("familiar switches can't leak another familiar's generations (loadSeq guard)", () => {
  // Canonical stale-response guard (familiar-work-queue-view): each load bumps
  // the epoch, and both resolution paths discard responses from older epochs —
  // an in-flight fetch for the previous familiar can never land.
  assert.match(tab, /const loadSeq = useRef\(0\)/);
  assert.match(tab, /const seq = \+\+loadSeq\.current/);
  const staleGuards = tab.match(/seq !== loadSeq\.current/g) ?? [];
  assert.ok(staleGuards.length >= 2, "success AND catch paths must check the epoch");
  // On a familiar switch the previous rows drop immediately (loading/empty,
  // never another familiar's generations) and the kind filter resets to All
  // so a kind the new familiar lacks can't strand an empty view.
  assert.match(tab, /loadedFamiliarRef\.current !== familiarId/);
  assert.match(tab, /setGenerations\(\[\]\);\s*setFilter\("all"\);/);
});

test("remove treats the DELETE 404 as success — no phantom rows", () => {
  // A generation already gone server-side ("generation not found") is a
  // completed removal: the row leaves the list instead of re-erroring.
  assert.match(tab, /!result\.ok && result\.error === "generation not found"/);
  assert.match(tab, /if \(!result\.ok && !alreadyGone\)/);
});
