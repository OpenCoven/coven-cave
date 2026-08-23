// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const renderedText = readFileSync(new URL("../lib/chat-rendered-text.ts", import.meta.url), "utf8");
const previewCard = readFileSync(new URL("./chat-preview-card.tsx", import.meta.url), "utf8");
const quickChat = readFileSync(new URL("./quick-chat-thread.tsx", import.meta.url), "utf8");
const runSurface = readFileSync(new URL("./research-run-surface.tsx", import.meta.url), "utf8");
const desk = readFileSync(new URL("./role-surfaces/research-tab-desk.tsx", import.meta.url), "utf8");
const missionDetail = readFileSync(new URL("./role-surfaces/research-mission-detail.tsx", import.meta.url), "utf8");
const missionsHook = readFileSync(new URL("./role-surfaces/use-research-missions.ts", import.meta.url), "utf8");

// Full chat: the public research marker is stripped from prose and projected
// through ChatView's already-shared preview rich-block seam. No chat-view fork.
assert.match(
  renderedText,
  /extractResearchRunMarkers\(reasoningSplit\.visible\)/,
  "canonical transcript projection extracts research markers",
);
assert.match(
  renderedText,
  /__coven\/research/,
  "full chat emits a reserved internal rich-card descriptor for research runs",
);
assert.match(
  previewCard,
  /<ResearchRunInlineCard snapshot=\{research\}/,
  "the existing full-chat preview renderer switches reserved descriptors to the research card",
);

// Quick Chat uses the same surface directly.
assert.match(
  quickChat,
  /<ResearchRunInlineCard key=\{run\.runId\} snapshot=\{run\}/,
  "quick chat renders the shared inline research card",
);

// The card is a projection, never a second source of truth: it immediately
// rehydrates by run id and sends controls to the existing mission action API.
assert.match(
  runSurface,
  /getResearchMission\(snapshot\.runId/,
  "inline cards rehydrate from the canonical mission API",
);
assert.match(
  runSurface,
  /actOnResearchMission\(run\.runId, \{ action \}\)/,
  "inline controls use the canonical mission action API",
);

// Research Desk remains the rich workspace projection over that same durable
// ResearchMission object and keeps its existing 2s live polling contract.
assert.match(desk, /<ResearchMissionDetail/, "Research Desk renders mission detail as its workspace projection");
assert.match(missionDetail, /mission: ResearchMission/, "workspace detail consumes the canonical ResearchMission");
assert.match(missionsHook, /POLL_INTERVAL_MS = 2_000/, "Research Desk keeps canonical mission state fresh");

console.log("research run surface wiring: ok");
