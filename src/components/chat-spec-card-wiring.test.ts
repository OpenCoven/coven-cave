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
  /splitSegmentsForImages\(\s*splitSegmentsForPreviews\(\s*splitSegmentsForSpecs\(\[\{ kind: "text", text: visibleWithGh \}\], onOpenUrl\)/,
);
// The contract is that spec/artifact/preview/GitHub splitting runs ONLY once a
// turn settles — a pending turn keeps the ordinary streaming markdown path,
// because a marker or fence that is still arriving would be split half-formed.
// The old pattern additionally fixed the branch's polarity as `if
// (!turn.pending)`; the streaming work writes the same choice the other way
// round, with the pending arm first. Read the polarity off the source and check
// the split lands in the settled arm either way.
const segmentBranch = chatView.match(
  /let renderSegments: MessageBubbleSegment\[\] \| undefined;\s*if \((!?)turn\.pending\) \{([\s\S]*?)\n  \} else \{([\s\S]*?)\n  \}/,
);
assert.ok(
  segmentBranch,
  "TurnRow should choose its render segments on the turn's pending state",
);
{
  const [, negated, firstArm, secondArm] = segmentBranch;
  const settledArm = negated === "!" ? firstArm : secondArm;
  const pendingArm = negated === "!" ? secondArm : firstArm;
  assert.match(
    settledArm,
    /renderSegments = split\.some/,
    "settled turns run the spec/artifact/preview/GitHub splitters",
  );
  assert.doesNotMatch(
    pendingArm,
    /renderSegments = split/,
    "pending turns stay on the ordinary streaming path",
  );
}

console.log("chat-spec-card wiring: all assertions passed");
