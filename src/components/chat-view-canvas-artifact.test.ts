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
assert.match(src, /splitTextForArtifacts\(visible/, "splits the plain text path (no tools)");

console.log("chat-view canvas artifact wiring: ok");
