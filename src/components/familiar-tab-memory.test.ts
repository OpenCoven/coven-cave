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
