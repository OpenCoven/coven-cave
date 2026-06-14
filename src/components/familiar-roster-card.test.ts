// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiars-view.tsx", import.meta.url), "utf8");
const card = source.match(/function FamiliarRosterCard[\s\S]*?\n\}\n/)?.[0] ?? "";

assert.ok(card.length > 0, "FamiliarRosterCard function should be present in familiars-view.tsx");

assert.match(card, /aria-label=\{`Open \$\{familiar\.display_name\}`\}/, "Card has accessible label naming the familiar");

assert.match(
  card,
  /Icon name=\{glyph\}/,
  "Card renders the familiar glyph (familiar.icon, with circle-half-tilt fallback)",
);

assert.match(card, /familiar\.display_name/, "Card shows display name");
assert.match(card, /familiar\.role \|\| familiar\.harness \|\| familiar\.id/, "Card shows role / harness / id fallback chain");

assert.match(
  card,
  /daemonRunning \? "online" : "offline"/,
  "Status row shows online/offline tied to daemonRunning",
);

assert.match(
  card,
  /stats\.hasActiveSession \?[\s\S]*active session/,
  "Active-session pill rendered when stats.hasActiveSession",
);

assert.match(
  card,
  /responseNeeded \?[\s\S]*response needed/,
  "Response-needed chip rendered when responseNeeded",
);

assert.match(card, /No sessions yet/, "Activity line handles zero-session case");
assert.match(card, /this week/, "Activity line shows sessionsLast7d label");

assert.match(
  card,
  /memoryStatus === "loading"[\s\S]*Loading memory/,
  "Memory snapshot shows 'Loading memory…' while the fetch is in flight",
);

assert.match(
  card,
  /memoryStatus === "error"[\s\S]*Memory unavailable/,
  "Memory snapshot falls back to 'Memory unavailable' when memory feed errored",
);

assert.match(
  card,
  /No memories yet/,
  "Memory snapshot shows 'No memories yet' for zero-memory familiars in the ready state",
);

assert.match(
  card,
  /stats\.memoryCount === 1 \? "y" : "ies"/,
  "Memory count pluralization is correct",
);

assert.match(
  card,
  /stats\.latestMemory\.title/,
  "Latest memory title is rendered",
);

console.log("familiar-roster-card: all assertions passed");
