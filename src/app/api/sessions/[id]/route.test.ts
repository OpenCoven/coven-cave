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

  await config.setSessionTitle(id, "Auto title A");
  const sameTextConflict = await patch({
    title: "Generated title B",
    titleOwnership: "auto",
    replaceManualTitle: true,
    observedTitle: "Auto title A",
    observedTitleRevision: observedRevision,
  });
  assert.equal(sameTextConflict.status, 200);
  assert.equal(sameTextConflict.body.titleUpdated, false);
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
  assert.equal(success.body.titleUpdated, true);
  state = await config.loadState();
  assert.equal(state.sessionTitles[id], "Generated title B");
  assert.equal(state.sessionTitleAuto[id], "Generated title B");

  const staleRevision = config.sessionTitleRevision(state, id);
  await config.setSessionTitle(id, "Newer manual title");
  const staleConflict = await patch({
    title: "Stale generated title",
    titleOwnership: "auto",
    replaceManualTitle: true,
    observedTitle: "Generated title B",
    observedTitleRevision: staleRevision,
  });
  assert.equal(staleConflict.body.titleUpdated, false);
  state = await config.loadState();
  assert.equal(state.sessionTitles[id], "Newer manual title");
  assert.equal(state.sessionTitleManual[id], true);

  const unsafeLegacyTakeover = await patch({
    title: "Legacy takeover",
    titleOwnership: "auto",
    replaceManualTitle: true,
    autoDefaults: ["Newer manual title"],
  });
  assert.equal(unsafeLegacyTakeover.status, 400);
  state = await config.loadState();
  assert.equal(state.sessionTitles[id], "Newer manual title");
} finally {
  process.env.HOME = previousHome;
  await rm(testHome, { recursive: true, force: true });
}

console.log("sessions [id] route.test.ts: ok");
