// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("./canvas-view.tsx", import.meta.url), "utf8");

// The composer's Blank control is now a dropdown (Popover) anchored on the
// Blank button, listing Blank + the templates.
assert.match(src, /\bCANVAS_TEMPLATES\b/, "imports the templates");
assert.match(src, /type CanvasTemplate/, "imports the template type");
assert.match(src, /ref=\{templatesAnchorRef\}[\s\S]*?onClick=\{\(\) => setTemplatesOpen/, "Blank button anchors + toggles the dropdown");
assert.match(src, /<Popover[\s\S]*?open=\{templatesOpen\}[\s\S]*?anchorRef=\{templatesAnchorRef\}/, "Popover wired to the anchor + open state");
assert.match(src, /createArtifact\("", \{ blank: true \}\)[\s\S]*?setTemplatesOpen\(false\)/, "Blank item creates a blank sketch");
assert.match(
  src,
  /CANVAS_TEMPLATES\.map\(\(t\) => \([\s\S]*?createArtifact\("", \{ template: t \}\)/,
  "each template creates an artifact from that template",
);

// createArtifact applies the template's title/code/kind and skips generation.
assert.match(src, /opts\?: \{ blank\?: boolean; template\?: CanvasTemplate \}/, "createArtifact accepts a template");
assert.match(src, /const starter = opts\?\.blank \|\| !!template;[\s\S]*?if \(!starter && !prompt\) return;/, "templates are starters (no prompt required, no generation)");
assert.match(src, /title: template \? template\.label/, "template title applied");
assert.match(src, /code: template \? template\.code/, "template code applied");
assert.match(src, /kind: template \? template\.kind/, "template kind applied");

console.log("canvas-templates-ui.test.ts: ok");
