import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Legacy raw-secret pairings never expire, so the rolling renewal never fired
// for them and a paired device stayed on the never-expiring credential
// forever (cave-id5). The app now exchanges a no-expiry token once for a
// signed 30-day one — the server's refresh route accepts the raw secret as a
// valid credential precisely to offer this migration path. After the swap the
// stored token has an expiry, so the branch self-disarms.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");

// The no-expiry branch must migrate (refresh + persist), not bail out early.
const migration = model.match(
  /guard let expiry = CaveInvite\.tokenExpiry\(token\) else \{[\s\S]*?refreshAccessToken\(\)[\s\S]*?saveAccessToken\(fresh\)[\s\S]*?return\s*\}/,
);
assert.ok(
  migration,
  "tokenExpiry==nil (legacy raw secret) must refresh once to a signed token instead of returning early",
);

// The old guard folded the expiry parse into the multi-let and silently
// skipped legacy tokens — it must not come back.
assert.doesNotMatch(
  model,
  /let token = CaveConnection\.accessToken,\s*\n?\s*let expiry = CaveInvite\.tokenExpiry\(token\) else \{ return \}/,
  "legacy raw-secret tokens must not be skipped by the renewal guard",
);

// The rolling 7-day renewal for signed tokens stays intact alongside.
assert.match(
  model,
  /let renewalWindow: TimeInterval = 7 \* 24 \* 3600/,
  "signed-token rolling renewal window survives the migration change",
);

console.log("ios-legacy-token-migration.test.mjs: ok");
