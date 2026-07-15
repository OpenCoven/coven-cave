// @ts-nocheck
// Wiring pins: the chat stage header (cave-fpqx.10) must read the SHARED
// stage model, mount above the transcript, and stay invisible for plain chat.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const header = readFileSync(new URL("./chat-stage-header.tsx", import.meta.url), "utf8");
const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const queue = readFileSync(new URL("../lib/beads-work-queue.ts", import.meta.url), "utf8");

// One stage model for queue + header (the design's acceptance criterion).
assert.match(header, /resolveStageForBranch\(\{ branch, open: state\.open, merged: state\.merged, beads: state\.beads \}\)/, "header resolves stage through the shared model");
assert.match(queue, /import \{ resolveQueueLane \} from "\.\/stage-model\.ts";/, "queue imports the extracted lane mapping");
assert.match(queue, /const prLaneToQueueLane = resolveQueueLane;/, "queue lane mapping is the stage-model function — no drift");

// Data provenance: PR truth from the bridge, bead truth from bd ready.
assert.match(header, /\/api\/beads\/prs\?projectRoot=/, "header reads the PR bridge");
assert.match(header, /\/api\/beads\?mode=ready&projectRoot=/, "header reads ready beads");

// Clean-chat rule + poll discipline.
assert.match(header, /if \(!snapshot\) return null;/, "renders nothing without a PR/bead anchor");
assert.match(header, /usePausablePoll\(.*\{\s*\n?\s*enabled: Boolean\(projectRoot && branch && snapshot\?\.pr\),/s, "re-polls only while an open PR anchors the stage");

// Mounted between the top bar and the transcript.
assert.match(
  chatView,
  /<ChatStageHeader projectRoot=\{session\?\.project_root \?\? projectRoot \?\? null\} onOpenUrl=\{onOpenUrl\} \/>/,
  "header keys on the SESSION root — the same derivation the rail badge listeners use (cave-r0gt)",
);

// Review follow-up (#3173): no cross-project stale bleed.
assert.match(header, /keyRef\.current !== key/, "bridge state resets when (projectRoot, branch) changes");
assert.match(header, /\{ \.\.\.EMPTY_BRIDGE, loaded: true \}/, "fetch failures clear stage data instead of preserving another project's");

console.log("chat stage header wiring: ok");
