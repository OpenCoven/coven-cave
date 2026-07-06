// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-studio-brain-tab.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(source, /export function FamiliarStudioBrainTab/);
assert.match(source, /harness/);
assert.match(source, /model/);
assert.match(source, /familiar-studio-brain__label">Runtime<\/span>/, "Brain tab should label harness selection as Runtime");
assert.doesNotMatch(source, /familiar-studio-brain__label">Harness<\/span>/, "Brain tab should not show Harness as the product label");
assert.match(
  source,
  /catalogForRuntime/,
  "Brain tab model menu should source options from the runtime → provider catalog",
);
assert.match(
  source,
  /modelOptions\.map/,
  "Brain tab should render a model select from the catalog options",
);
assert.match(
  source,
  /allowCustomModel/,
  "Brain tab should keep a free-text fallback for ids not in the curated catalog",
);
assert.match(
  source,
  /type="text"[\s\S]{0,320}autoCapitalize="none"[\s\S]{0,80}autoCorrect="off"[\s\S]{0,80}spellCheck=\{false\}/,
  "Brain tab custom model input should not auto-capitalize, autocorrect, or spellcheck model ids",
);
assert.match(source, /note/);
assert.match(source, /\/api\/harnesses/);
assert.match(source, /\/api\/config/);
assert.match(source, /method.*PATCH/);
assert.match(
  source,
  /defaultHarnessLabel/,
  "Brain tab should name the inherited workspace default runtime",
);
assert.match(
  source,
  /label: `Inherit workspace default: \$\{defaultHarnessLabel\}`/,
  "Default runtime copy should clarify that this familiar inherits the workspace default",
);
assert.match(
  source,
  /label: "Available runtimes"[\s\S]{0,240}harnesses\.map/,
  "Other available runtimes should be grouped below the inherited default option",
);
assert.match(
  source,
  /\/api\/capabilities\?harness=/,
  "Brain tab should fetch the daemon capabilities manifest for the selected harness",
);
assert.match(
  source,
  /familiar-studio-brain__capabilities/,
  "Brain tab should expose a per-familiar capabilities accordion",
);
assert.match(
  source,
  /familiar-studio-brain__workspace/,
  "Brain tab should render a full-width workspace shell",
);
assert.match(
  source,
  /familiar-studio-brain__primary/,
  "Brain tab should keep runtime, model, and prompt in the primary column",
);
assert.match(
  source,
  /familiar-studio-brain__sidecar/,
  "Brain tab should move voice and capabilities into a sidecar column",
);
assert.match(
  source,
  /Runtime & model/,
  "Brain tab should group runtime and model controls under a single section",
);
assert.match(
  css,
  /\.familiar-studio-brain__workspace\s*\{[\s\S]{0,220}grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(260px,\s*320px\)/,
  "Brain workspace CSS should use a full-width primary column plus a bounded sidecar",
);
assert.match(
  css,
  /@media \(max-width: 860px\)[\s\S]*\.familiar-studio-brain__workspace\s*\{[\s\S]{0,120}grid-template-columns:\s*1fr/,
  "Brain workspace should collapse to one column on narrow surfaces",
);

// ── Reflection: autoSelfReport toggle (2026-07-06) ───────────────────────────
// The config field was wired end-to-end (GET /api/familiars → chat-view's
// session-close self-report) but had no UI. It saves through the tab's shared
// /api/config patch helper; `null` deletes the key (resolved default: false).
assert.match(source, /Auto self-report/, "Brain tab exposes the auto self-report toggle");
assert.match(source, /role="switch"[\s\S]{0,80}aria-checked=\{draftAutoSelfReport\}/, "the toggle is a proper switch");
assert.match(source, /autoSelfReport: next \? true : null/, "off deletes the config key instead of writing false");
assert.match(source, /if \("autoSelfReport" in patch\) setDraftAutoSelfReport/, "failed saves revert the toggle draft");

console.log("familiar-studio-brain-tab.test.ts: ok");
