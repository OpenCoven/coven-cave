// @ts-nocheck
// Auto-detect wiring: TurnRow must inject the ChatArtifactViewer for renderable
// code blocks regardless of whether tool activity is shown.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

assert.match(src, /import .*ChatArtifactViewer.* from "@\/components\/chat-artifact-viewer"/, "imports the viewer");
assert.match(src, /extractArtifactBlocks/, "uses extractArtifactBlocks to find blocks");
assert.match(src, /function splitTextForArtifacts/, "has the text→segments splitter");
assert.match(src, /<ChatArtifactViewer\b/, "renders the viewer as a block segment");
assert.match(
  src,
  /splitSegmentsForArtifacts\(\s*splitSegmentsForImages\(\s*splitSegmentsForSpecs\(\[\{ kind: "text", text: visibleWithGh \}\], onOpenUrl\)/,
  "splits remaining prose after image decks, without crossing an inline carousel",
);
assert.match(
  src,
  /const preceding = text\.slice\(cursor, b\.index\)\.trim\(\)/,
  "each artifact titles from the prose since the previous block, not the whole message",
);

console.log("chat-view canvas artifact wiring: ok");
