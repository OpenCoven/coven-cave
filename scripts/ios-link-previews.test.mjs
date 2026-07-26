import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const base = "../apps/ios/CovenCave/CovenCave/Views";
const read = (p) => readFile(new URL(`${base}/${p}`, import.meta.url), "utf8");

const lp = await read("LinkPreview.swift");
assert.match(lp, /import LinkPresentation/, "should use the LinkPresentation framework");
assert.match(
  lp,
  /func firstLink\(in text: String\) -> URL\?[\s\S]*NSDataDetector[\s\S]*scheme == "http" \|\| scheme == "https"/,
  "firstLink should extract the first http(s) URL via NSDataDetector",
);
assert.match(lp, /final class LinkMetadataCache[\s\S]*func fetch\(_ url: URL\) async -> LPLinkMetadata\?/, "metadata should be cached + fetched");
assert.match(lp, /struct LinkPreviewCard: View[\s\S]*LinkMetadataCache\.shared\.fetch\(url\)/, "LinkPreviewCard should fetch then render");
// Custom SwiftUI card (LPLinkView doesn't size in SwiftUI) with a non-EmptyView
// placeholder so the fetch task actually runs.
assert.doesNotMatch(lp, /LPLinkView\(/, "should not embed an LPLinkView (doesn't size in SwiftUI)");
assert.match(lp, /Color\.clear\.frame\(width: 1, height: 1\)/, "should keep a non-empty placeholder so .task runs");
assert.match(lp, /Text\(m\.title \?\? url\.host/, "the card should show the title");

const bubble = await read("MessageBubble.swift");
assert.match(
  bubble,
  /if !message\.streaming, let link = firstLink\(in: parsed\.visible\) \{\s*LinkPreviewCard\(url: link\)/,
  "MessageBubble should show a LinkPreviewCard for the first link in a finished message",
);

console.log("ios-link-previews: ok");
