// iOS thread lists hide generated runs (cave-48aa) — parity with the web's
// isGeneratedChatSession (src/lib/chat-projects.ts). Source pins on the Swift
// files; the two rule sets must not drift apart.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const models = readFileSync(
  new URL("../apps/ios/CovenCave/CovenCave/Models/Models.swift", import.meta.url),
  "utf8",
);
const appModel = readFileSync(
  new URL("../apps/ios/CovenCave/CovenCave/State/AppModel.swift", import.meta.url),
  "utf8",
);
const web = readFileSync(new URL("../src/lib/chat-projects.ts", import.meta.url), "utf8");

// The model decodes the provenance /api/sessions/list already serves.
assert.match(models, /var origin: String\?/, "SessionRow decodes origin");
assert.match(models, /var generated: Bool\?/, "SessionRow decodes generated");
assert.match(models, /case origin, generated/, "…and both ride CodingKeys");

// The rule mirrors the web: generated flag, hidden origins, legacy prompts.
assert.match(models, /var isGeneratedRun: Bool/, "SessionRow exposes isGeneratedRun");
assert.match(
  models,
  /\["cron", "heartbeat", "canvas", "journal"\]\.contains\(origin\)/,
  "hidden origins match the web's CHAT_HIDDEN_ORIGINS",
);
assert.match(
  models,
  /hasPrefix\("Write a short narrative of my day \("\)/,
  "legacy daily-narrative titles hide",
);
assert.match(
  models,
  /hasPrefix\("Write a short, first-person reflective journal entry"\)/,
  "legacy reflection titles hide (truncation-safe prefix)",
);

// The list actually applies it.
assert.match(
  appModel,
  /!\$0\.isGeneratedRun/,
  "serverOnlySessions filters generated runs out of the thread list",
);

// Drift guard: the web rule still contains the same origins + prefixes, so a
// change there should visit this file too.
for (const origin of ["cron", "heartbeat", "canvas", "journal"]) {
  assert.ok(web.includes(`"${origin}"`), `web CHAT_HIDDEN_ORIGINS still includes ${origin}`);
}
assert.ok(
  web.includes("Write a short narrative of my day ("),
  "web keeps the daily-narrative legacy prefix",
);
assert.ok(
  web.includes("Write a short, first-person reflective journal entry"),
  "web keeps the reflection legacy prefix",
);

console.log("ios-hide-generated-sessions: ok");
