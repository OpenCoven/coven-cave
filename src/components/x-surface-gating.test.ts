// @ts-nocheck
// The X surfaces render only for familiars that have the capability (cave-lsj8u).
//
// HISTORY, because this file's own instructions changed and a reader who
// followed the old ones would break the surfaces.
//
// It was written when the X work had landed its lib/ and components/ half on
// main and left src/app/api/x/ behind entirely: both surfaces rendered
// unconditionally, every fetch 404'd, and each showed a permanent ErrorState.
// The gate was a stopgap, and this file carried a tripwire asserting
// src/app/api/x/ did NOT exist, telling a future reader to delete the gates
// and this test once the routes landed.
//
// The routes have landed and that instruction was wrong. The gate is no
// longer a workaround for missing routes — it mirrors a server-side rule:
// every X route calls requireXCapability(familiarId, "research"), which
// throws `capability-disabled` when the flag is off. Deleting the gate would
// render both surfaces for familiars without the capability and show them a
// permanent error: the same failure, a different error code.
//
// So the gate stays. What is pinned is that client and server agree.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const studio = readFileSync(new URL("./familiar-studio-brain-tab.tsx", import.meta.url), "utf8");
const research = readFileSync(
  new URL("./role-surfaces/research-tab-resources.tsx", import.meta.url),
  "utf8",
);
const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");
const familiarsRoute = readFileSync(new URL("../app/api/familiars/route.ts", import.meta.url), "utf8");
const sourcesRoute = readFileSync(new URL("../app/api/x/sources/route.ts", import.meta.url), "utf8");

test("the gate reads flags that actually reach the client", () => {
  // A gate on a field the API never sends would hide the surface forever and
  // look like a bug rather than a decision.
  for (const flag of ["xResearchEnabled", "xPublishEnabled"]) {
    assert.match(types, new RegExp(`${flag}\\?: boolean`), `Familiar carries ${flag}`);
    assert.match(familiarsRoute, new RegExp(`${flag}: configEntry\\.${flag} === true`),
      `/api/familiars emits ${flag}`);
  }
});

test("the research surface is gated on the research capability", () => {
  assert.match(
    research,
    /\{context\.activeFamiliar\?\.xResearchEnabled \? \(\s*<ResearchXSources/,
    "ResearchXSources renders only when the familiar has X research enabled",
  );
});

test("the studio connection section is gated on EITHER capability", () => {
  // The connection serves both halves, so whichever lands first re-exposes it.
  assert.match(
    studio,
    /\{familiar\.xResearchEnabled \|\| familiar\.xPublishEnabled \? \(\s*<FamiliarXSection/,
    "FamiliarXSection renders when either X capability is enabled",
  );
});

test("the client gate mirrors the server's capability check", () => {
  // This assertion replaces a tripwire that asserted src/app/api/x/ did NOT
  // exist, whose message instructed a future reader to delete the gates and
  // this file once the routes landed. The routes have landed and that
  // instruction was wrong.
  //
  // The gate began as a stopgap for missing routes, but it is no longer that:
  // every X route calls requireXCapability(familiarId, "research"), which
  // throws `capability-disabled` when the flag is off. Removing the gate would
  // render both surfaces for familiars without the capability and show them a
  // permanent error — the same failure the gate was added to prevent, only
  // with a different error code. So the gate stays, and what is pinned now is
  // that client and server agree about who may see it.
  assert.match(
    sourcesRoute,
    /requireXCapability\(familiarId, "research"\)/,
    "the routes enforce the same capability the UI gates on",
  );
});
