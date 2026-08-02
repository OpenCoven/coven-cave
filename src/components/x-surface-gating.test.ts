// @ts-nocheck
// The X surfaces stay hidden until their routes exist (cave-lsj8u).
//
// The X work landed its lib/ and components/ half on main and left
// src/app/api/x/ behind entirely. Both surfaces rendered unconditionally, so
// every fetch 404'd and each showed a permanent ErrorState — a section that
// can only ever fail, offered to every user.
//
// These pins hold the gate in place. They are deliberately cheap to satisfy
// and cheap to DELETE: when the routes land, removing the conditions makes
// these fail, which is the prompt to remove the pins too.
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";

const studio = readFileSync(new URL("./familiar-studio-brain-tab.tsx", import.meta.url), "utf8");
const research = readFileSync(
  new URL("./role-surfaces/research-tab-resources.tsx", import.meta.url),
  "utf8",
);
const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");
const familiarsRoute = readFileSync(new URL("../app/api/familiars/route.ts", import.meta.url), "utf8");

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

test("the gate exists because the routes do not", () => {
  // The moment this stops being true, the gate is obsolete: delete the
  // conditions and this file together.
  assert.equal(
    existsSync(new URL("../app/api/x/", import.meta.url)),
    false,
    "src/app/api/x/ has landed — remove the gates in familiar-studio-brain-tab " +
      "and research-tab-resources, and delete this test (cave-lsj8u)",
  );
});
