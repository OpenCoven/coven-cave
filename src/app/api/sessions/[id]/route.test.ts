// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  route,
  /if \(body\.titleOwnership === "auto"\)[\s\S]*setSessionTitleAutoIfOwned\(id, body\.title, safeDefaults\)/,
  "automatic title PATCHes use the atomic ownership gate",
);
assert.match(
  route,
  /const safeDefaults = new Set\(\[defaultChatTitleForSession\(id\)\]\)/,
  "the server always derives its canonical known default",
);
assert.match(
  route,
  /if \(current && observedDefaults\.has\(current\)\) safeDefaults\.add\(current\)/,
  "client defaults are admitted only when they match the server's current title",
);
assert.match(
  route,
  /body\.autoDefaults\.length > 4/,
  "automatic defaults are bounded rather than trusted as an arbitrary client set",
);
assert.match(
  route,
  /result\.titleUpdated = next !== null/,
  "the response distinguishes an applied automatic title from a preserved manual title",
);
assert.match(
  route,
  /result\.title = next \?\? \(await loadState\(\)\)\.sessionTitles\[id\] \?\? null/,
  "a skipped automatic write returns the title that was preserved",
);
assert.match(
  route,
  /\} else \{\s*const next = await setSessionTitle\(id, body\.title\)/,
  "ordinary title PATCHes remain explicitly manual",
);

console.log("sessions [id] route.test.ts: ok");
