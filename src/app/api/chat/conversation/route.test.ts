// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  route,
  /initializeSessionTitleOwnership/,
  "voice-created defaults must use the atomic ownership initializer",
);
assert.doesNotMatch(
  route,
  /\bsetSessionTitle:\s*async/,
  "voice creation must not mark its generated default as a manual title",
);

assert.match(
  route,
  /authorizeChatProjectLaunch/,
  "voice conversation creation should use the shared project launch gate",
);
assert.match(
  route,
  /surface:\s*"session-launch"/,
  "voice creation should enforce the session-launch permission surface",
);
assert.match(
  route,
  /ChatProjectLaunchError/,
  "voice creation should return stable project launch errors",
);
assert.match(
  route,
  /code:\s*error\.code[\s\S]*status:\s*error\.status/,
  "voice creation should preserve the launch error code and HTTP status",
);

const authorizeIndex = route.indexOf("await authorizeChatProjectLaunch");
const createIndex = route.indexOf("await createVoiceChatSession");
const familiarIndex = route.indexOf("await deps.loadFamiliarBinding");
assert.ok(familiarIndex >= 0, "voice route should reject an unknown familiar explicitly");
assert.ok(
  familiarIndex < authorizeIndex,
  "unknown familiars should keep the existing 404 contract before project authorization",
);
assert.ok(authorizeIndex >= 0, "voice route should await project authorization");
assert.ok(createIndex > authorizeIndex, "voice route must authorize before minting a conversation");
assert.match(
  route,
  /initializeSessionTitleOwnership:\s*async[\s\S]*await initializeSessionTitleOwnership\(/,
  "voice-created defaults should initialize automatic provenance atomically",
);
assert.doesNotMatch(
  route,
  /\bsetSessionTitleAuto\(/,
  "voice creation must not use the unconditional automatic title setter",
);
assert.doesNotMatch(
  route,
  /\bsetSessionTitle:\s*async/,
  "voice-created defaults must not be marked as manually owned",
);

console.log("chat conversation route.test.ts: ok");
