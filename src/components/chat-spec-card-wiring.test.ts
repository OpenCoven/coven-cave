// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

assert.match(
  chatView,
  /import \{ sliceSpecBlocks \} from "@\/lib\/spec-blocks"/,
);
assert.match(
  chatView,
  /import \{ ChatSpecCard \} from "@\/components\/chat-spec-card"/,
);
assert.match(
  chatView,
  /function splitSegmentsForSpecs\(\s*segments: MessageBubbleSegment\[\],\s*onOpenUrl\?: \(url: string\) => void,/,
);
assert.match(
  chatView,
  /<ChatSpecCard spec=\{piece\.spec\} onOpenUrl=\{onOpenUrl\} \/>/,
);
assert.match(
  chatView,
  /splitSegmentsForImages\(\s*splitSegmentsForSpecs\(\[\{ kind: "text", text: visibleWithGh \}\], onOpenUrl\)/,
);
assert.match(
  chatView,
  /if \(turn\.pending\) \{[\s\S]*?renderSegments = bubbleSegments;/,
  "pending turns stay on the ordinary streaming path",
);

console.log("chat-spec-card wiring: all assertions passed");
