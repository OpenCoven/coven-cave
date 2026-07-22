// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Familiar tab — Memory section (design-handoff rebuild). Pins the honest-data
// contract: the list is scoped to the familiar, reads stay redacted (no
// reveal), writes carry the optimistic-concurrency baseline and surface mtime
// conflicts instead of clobbering, Esc returns to preview, and the collapse
// animation respects prefers-reduced-motion.

const src = readFileSync(new URL("./familiar-tab-memory.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/familiar-tab-memory.css", import.meta.url), "utf8");

test("list fetch is scoped to this familiar via familiarId", () => {
  assert.match(
    src,
    /fetch\(`\/api\/memory\?familiarId=\$\{encodeURIComponent\(familiar\.id\)\}`/,
    "GET /api/memory carries familiarId",
  );
});

test("file reads stay redacted — the component never asks for a reveal", () => {
  assert.match(src, /fetch\(`\/api\/memory\/file\?path=\$\{encodeURIComponent\(selectedPath\)\}`/, "read by fullPath");
  assert.doesNotMatch(src, /reveal=1/, "no ?reveal=1 query");
  assert.doesNotMatch(src, /reveal:\s*true/, "no reveal option smuggled through a hook");
  // The redaction guard: redacted files are read-only so a save can never
  // write placeholders over real secrets.
  assert.match(src, /const readOnly = file\.redactionCount > 0/, "redacted files are read-only");
  assert.match(src, /readOnly=\{readOnly\}/, "textarea honors the guard");
});

test("saves send expectedMtimeMs and a stale baseline surfaces as an honest conflict", () => {
  assert.match(src, /method: "PUT"/, "writes go through PUT /api/memory/file");
  assert.match(
    src,
    /expectedMtimeMs: file\.mtimeMs/,
    "the loaded mtime rides along as the optimistic-concurrency baseline",
  );
  assert.match(src, /res\.status === 409/, "409 is recognized as a conflict, not a generic failure");
  assert.match(
    src,
    /File changed on disk — reload before editing\./,
    "conflict copy is honest about what happened",
  );
  assert.match(
    src,
    /kind === "conflict"[\s\S]{0,300}?onClick=\{reloadSelectedFile\}/,
    "conflicts offer a reload affordance",
  );
  assert.doesNotMatch(src, /force:\s*true/, "no silent-clobber escape hatch");
});

test("successful saves advance the stored mtime and the preview text", () => {
  assert.match(
    src,
    /setFile\(\(prev\) => \(\{\s*\.\.\.prev,\s*text: nextText,\s*mtimeMs: typeof json\.mtimeMs === "number" \? json\.mtimeMs : prev\.mtimeMs,/,
    "text + mtime baseline both move to what was written",
  );
  // A save response that lands after the user switched files must not write
  // the old file's text/baseline into the new file's pane (PR #3655 follow-up).
  assert.match(src, /const stillSelected = selectedPathRef\.current === selectedPath;/, "responses check the live selection");
  assert.match(src, /if \(stillSelected\) \{\s*setFile/, "pane state only moves for the still-selected file");
  // The list row's size column is bytes on disk, not UTF-16 code units.
  assert.match(src, /size: new TextEncoder\(\)\.encode\(nextText\)\.length/, "row size counts UTF-8 bytes");
  assert.doesNotMatch(src, /size: nextText\.length/, "no code-unit size");
});

test("drafts survive an unmount without a blur, without double-saving", () => {
  // Tab/familiar/file switches unmount the textarea before blur fires — and
  // React detaches element refs before passive cleanups, so the only reliable
  // copy of the draft at cleanup time is a value ref fed by onChange.
  assert.match(src, /draftRef\.current = \{ path: selectedPath, text: event\.currentTarget\.value \}/, "every keystroke mirrors the draft into a value ref");
  assert.match(src, /return \(\) => \{\s*const draft = draftRef\.current;[\s\S]{0,280}?commitEditRef\.current\(draft\.text\)/, "effect cleanup commits the mirrored draft");
  assert.match(src, /\}, \[view, readOnly, selectedPath, refreshToken\]\);/, "cleanup re-arms per file/view, not per commit identity");
  // Blur + cleanup can both fire for the same draft — the committed-draft ref
  // collapses the pair to one PUT instead of racing into a 409.
  assert.match(src, /committedDraftRef\.current\?\.path === selectedPath && committedDraftRef\.current\.text === nextText/, "identical in-flight/settled commits dedupe");
  assert.match(src, /committedDraftRef\.current = \{ path: selectedPath, text: nextText \}/, "commit records itself before the PUT");
});

test("Esc returns to preview (saving first), and only a failed save holds the draft", () => {
  assert.match(src, /event\.key !== "Escape"\) return;[\s\S]{0,600}?if \(ok\) setView\("preview"\)/, "Esc → preview after a good save");
  assert.match(src, /onBlur=\{[\s\S]{0,120}?commitEdit\(event\.currentTarget\.value\)/, "blur commits the draft");
  assert.match(src, /Saves as you click away · Esc for preview/, "helper line matches the behavior");
});

test("edit pane a11y + design conventions", () => {
  assert.match(src, /aria-label="Edit memory file"/, "textarea is labeled");
  assert.match(src, /aria-label=\{listOpen \? "Collapse memory files" : "Expand memory files"\}/, "toggle labels per state");
  assert.match(css, /\.familiar-memory-tab__textarea \{[^}]*background: var\(--bg-sunken\)/, "sunken editor field");
  assert.match(css, /\.familiar-memory-tab__textarea \{[^}]*border: 1px solid var\(--border-strong\)/, "strong border on the editor");
});

test("preview reuses the app's markdown renderer instead of a bespoke one", () => {
  assert.match(src, /import \{ MarkdownBlock \} from "@\/components\/message-bubble"/, "same renderer as the memory reader pane");
  assert.match(src, /onDoubleClick=\{\(\) => setView\("edit"\)\}/, "double-click preview enters edit");
});

test("collapse animation is guarded for reduced motion", () => {
  assert.match(
    css,
    /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\.familiar-memory-tab__grid \{\s*transition: grid-template-columns/,
    "grid-template-columns transition only runs when motion is welcome",
  );
  // No unguarded grid transition outside the media query.
  const beforeGuard = css.slice(0, css.indexOf("@media (prefers-reduced-motion"));
  assert.doesNotMatch(beforeGuard, /transition:/, "all transitions live behind the reduced-motion guard");
  assert.match(css, /\.familiar-memory-tab__grid--collapsed \{\s*grid-template-columns: 56px minmax\(0, 1fr\)/, "collapsed rail width");
});

test("empty state is quiet and routes to the existing memory studio convention", () => {
  assert.match(src, /No memory files yet/, "empty headline");
  assert.match(src, /openFamiliarStudioSettingsTab\("memory", familiar\.id\)/, "CTA uses the studio tab convention");
});
