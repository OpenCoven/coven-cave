// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  route,
  /if \(body\.titleOwnership === "auto"\)[\s\S]*setSessionTitleAutoIfOwned\([\s\S]*body\.observedTitleRevision/,
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

assert.match(
  route,
  /replaceManualTitle\?:\s*boolean/,
  "replaceManualTitle is an optional boolean field in PatchBody",
);
assert.match(
  route,
  /body\.replaceManualTitle === true[\s\S]*?titleOwnership[\s\S]*?!== "auto"/,
  "standalone replaceManualTitle: true without auto ownership is rejected",
);
assert.match(
  route,
  /observedTitleRevision\?:\s*number/,
  "explicit takeover accepts the ownership revision observed with the title",
);
assert.match(
  route,
  /replaceManualTitle[\s\S]*observedTitle[\s\S]*observedTitleRevision/,
  "explicit takeover requires both the observed title and its ownership revision",
);
assert.match(
  route,
  /setSessionTitleAutoIfOwned\([\s\S]*body\.observedTitleRevision[\s\S]*body\.observedTitle/,
  "explicit takeover passes the client observation into the atomic ownership mutation",
);
assert.match(
  route,
  /typeof body\.replaceManualTitle !== "boolean"/,
  "defined replaceManualTitle is validated as boolean or rejected with 400",
);
assert.match(
  route,
  /body\.replaceManualTitle === true[\s\S]*?body\.observedTitleRevision[\s\S]*?body\.replaceManualTitle === true[\s\S]*?body\.observedTitle/,
  "all replaceManualTitle branches use strict equality so non-boolean values cannot bypass protection",
);

const previousHome = process.env.HOME;
const testHome = await mkdtemp(path.join(process.cwd(), ".session-title-route-test-"));
process.env.HOME = testHome;

try {
  const config = await import("../../../../lib/cave-config.ts");
  const { PATCH } = await import("./route.ts");
  const id = "sparkle-title-cas";
  const params = { params: Promise.resolve({ id }) };
  const patch = async (body: unknown) => {
    const response = await PATCH(
      new Request(`http://127.0.0.1/api/sessions/${id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          host: "127.0.0.1",
          ...(process.env.COVEN_CAVE_AUTH_TOKEN
            ? { "x-coven-cave-token": process.env.COVEN_CAVE_AUTH_TOKEN }
            : {}),
        },
        body: JSON.stringify(body),
      }),
      params,
    );
    return { status: response.status, body: await response.json() };
  };

  await config.setSessionTitleAuto(id, "Auto title A");
  let state = await config.loadState();
  const observedRevision = config.sessionTitleRevision(state, id);

  const sameTextManual = await patch({ title: "Auto title A" });
  assert.equal(sameTextManual.status, 200);
  assert.equal(sameTextManual.body.titleUpdated, true);
  state = await config.loadState();
  assert.equal(state.sessionTitles[id], "Auto title A");
  assert.equal(state.sessionTitleManual[id], true);
  assert.equal(
    config.sessionTitleRevision(state, id),
    observedRevision + 1,
    "a same-text manual rename advances ownership revision",
  );

  const sameTextConflict = await patch({
    title: "Generated title B",
    titleOwnership: "auto",
    replaceManualTitle: true,
    observedTitle: "Auto title A",
    observedTitleRevision: observedRevision,
  });
  assert.equal(sameTextConflict.status, 409);
  assert.equal(sameTextConflict.body.ok, false);
  assert.equal(sameTextConflict.body.conflict, true);
  assert.equal(sameTextConflict.body.title, "Auto title A");
  assert.equal(sameTextConflict.body.titleRevision, observedRevision + 1);
  state = await config.loadState();
  assert.equal(state.sessionTitles[id], "Auto title A");
  assert.equal(state.sessionTitleManual[id], true);

  const currentRevision = config.sessionTitleRevision(state, id);
  const success = await patch({
    title: "Generated title B",
    titleOwnership: "auto",
    replaceManualTitle: true,
    observedTitle: "Auto title A",
    observedTitleRevision: currentRevision,
  });
  assert.equal(success.status, 200);
  assert.equal(success.body.titleUpdated, true);
  state = await config.loadState();
  assert.equal(state.sessionTitles[id], "Generated title B");
  assert.equal(state.sessionTitleAuto[id], "Generated title B");

  const manualRename = await patch({ title: "Ordinary manual rename" });
  assert.equal(manualRename.status, 200);
  assert.equal(manualRename.body.titleUpdated, true);
  state = await config.loadState();
  assert.equal(state.sessionTitles[id], "Ordinary manual rename");
  assert.equal(state.sessionTitleManual[id], true);
  assert.equal(state.sessionTitleAuto[id], undefined);

  const unsafeLegacyTakeover = await patch({
    title: "Legacy takeover",
    titleOwnership: "auto",
    replaceManualTitle: true,
    autoDefaults: ["Ordinary manual rename"],
  });
  assert.equal(unsafeLegacyTakeover.status, 400);
  state = await config.loadState();
  assert.equal(state.sessionTitles[id], "Ordinary manual rename");

  // A non-boolean replaceManualTitle must be rejected before any mutation.
  // String "false" is truthy, so without strict validation a current
  // observation authorizes the same manual-title takeover as boolean true.
  const manualRevision = config.sessionTitleRevision(state, id);
  const stringFalseRejection = await patch({
    title: "Injected title",
    titleOwnership: "auto",
    replaceManualTitle: "false",
    observedTitle: "Ordinary manual rename",
    observedTitleRevision: manualRevision,
    archived: true,
  });
  assert.equal(stringFalseRejection.status, 400, "string replaceManualTitle is rejected");
  state = await config.loadState();
  assert.equal(state.sessionTitles[id], "Ordinary manual rename", "title not overwritten by string replaceManualTitle");
  assert.equal(state.sessionTitleManual[id], true, "manual ownership not cleared by string replaceManualTitle");
  assert.equal(state.sessionArchived[id], undefined, "unrelated mutations do not run before validation");

  const numericOneRejection = await patch({
    title: "Injected title",
    titleOwnership: "auto",
    replaceManualTitle: 1,
    observedTitle: "Ordinary manual rename",
    observedTitleRevision: manualRevision,
  });
  assert.equal(numericOneRejection.status, 400, "numeric replaceManualTitle is rejected");
  state = await config.loadState();
  assert.equal(state.sessionTitles[id], "Ordinary manual rename", "title not overwritten by numeric replaceManualTitle");
} finally {
  process.env.HOME = previousHome;
  await rm(testHome, { recursive: true, force: true });
}

console.log("sessions [id] route.test.ts: ok");
