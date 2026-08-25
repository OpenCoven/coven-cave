import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hub = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/FamiliarHubView.swift", import.meta.url),
  "utf8",
);

// Attention is bounded independently from assigned work and reminders. An
// action-required item can therefore be outside either visible list; the hub
// must still render an actionable fallback rather than emitting an empty row.
const attention = hub.match(
  /private func attentionRow\([\s\S]*?\n    private func attentionFallbackLabel/,
)?.[0];
assert.ok(attention, "the attention row and its fallback should be findable");

assert.match(
  attention,
  /else if item\.source == "task" \{[\s\S]{0,300}?app\.requestOpenTask\(id: item\.targetId, projectId: nil\)/,
  "an overflow task attention item should still deep-link to its task",
);
assert.match(
  attention,
  /Task \{ await actOnReminder\(id: item\.targetId, action: "done"\) \}/,
  "an overflow fired reminder should still expose a completion action",
);
assert.match(
  attention,
  /attentionFallbackLabel\(item, systemImage: "bell\.badge"\)/,
  "an overflow reminder should render a visible fallback label",
);
assert.match(
  hub,
  /Text\(item\.title\)[\s\S]{0,1200}?minHeight: 44/,
  "fallback attention rows should retain their title and touch target",
);

console.log("ios-familiar-attention-overflow: ok");
