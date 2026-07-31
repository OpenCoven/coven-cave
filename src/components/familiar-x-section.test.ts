// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const componentUrl = new URL("./familiar-x-section.tsx", import.meta.url);
const cssUrl = new URL("../styles/familiar-x-section.css", import.meta.url);
assert.ok(existsSync(componentUrl), "FamiliarXSection must exist");
assert.ok(existsSync(cssUrl), "FamiliarXSection must own a stylesheet");

const source = readFileSync(componentUrl, "utf8");
const css = readFileSync(cssUrl, "utf8");
const brain = readFileSync(new URL("./familiar-studio-brain-tab.tsx", import.meta.url), "utf8");
const familiarRoute = readFileSync(new URL("../app/api/familiars/route.ts", import.meta.url), "utf8");
const oauthStartRoute = readFileSync(new URL("../app/api/x/oauth/start/route.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");

assert.match(source, /import "@\/styles\/familiar-x-section\.css"/);
assert.match(source, /import \{ Button \} from "@\/components\/ui\/button"/);
assert.match(source, /import \{ ErrorState \} from "@\/components\/ui\/error-state"/);
assert.match(source, /import \{ Skeleton/);
assert.match(source, /useArmedConfirm/);
assert.match(source, /useAnnouncer/);

assert.match(source, /fetch\("\/api\/x\/connection"/);
assert.match(source, /fetch\("\/api\/x\/oauth\/start"/);
assert.match(source, /sanitizeXConnection/);
assert.match(source, /X_SCOPES/);
assert.match(source, /oauthFlowId/);
assert.match(source, /oauthOutcome/);
assert.doesNotMatch(source, /accessToken|refreshToken/, "connection UI must never handle credentials");

assert.ok((source.match(/role="switch"/g) ?? []).length >= 2, "both grants use switches");
assert.ok((source.match(/settings-switch focus-ring/g) ?? []).length >= 2, "both switches keep focus rings");
assert.match(source, /\[grant\]: enabled \? true : null/, "grant patches write true or delete with null");
assert.match(
  source,
  /window\.dispatchEvent\(new Event\("cave:familiars-refresh"\)\)/,
  "successful grant saves refresh canonical familiar state",
);
assert.match(source, /disconnectConfirm\.trigger/);
assert.match(source, /Really disconnect X\?/);

assert.match(
  source,
  /!connection\.scopes\.includes\("tweet\.write"\)[\s\S]{0,300}startOAuth\("publish", "xPublishEnabled"\)/,
  "publish enablement upgrades OAuth before writing the grant",
);
assert.match(
  source,
  /next\.oauthFlowId === oauthAttempt\.flowId[\s\S]{0,160}next\.oauthOutcome === "succeeded"[\s\S]{0,220}saveGrant\(oauthAttempt\.grant, true\)/,
  "OAuth polling grants only after the exact started flow succeeds",
);
assert.match(source, /if \(!oauthAttempt\) return;/, "polling is gated by a user-started attempt");
assert.match(
  source,
  /familiarId: familiar\.id/,
  "OAuth attempts retain the exact initiating familiar",
);
assert.match(
  source,
  /oauthAttempt\.familiarId !== familiar\.id[\s\S]{0,180}setOauthAttempt\(null\)/,
  "switching familiars cancels the old attempt instead of granting the new familiar",
);
assert.match(source, /pendingOAuthRef/, "OAuth startup is tracked before polling begins");
assert.match(
  source,
  /cancelXOAuthFlow\(pending\.flowId\)/,
  "OAuth startup cleanup cancels only its own server-side flow",
);
assert.match(
  source,
  /const ownsPending = \(\) =>[\s\S]{0,240}pending\.familiarId === familiarIdRef\.current[\s\S]{0,160}pendingOAuthRef\.current === pending/,
  "post-await startup work cannot navigate after the Studio switches familiars",
);
assert.match(
  source,
  /if \(!ownsPending\(\)\) \{\s*await cancelPending\(\);\s*return;/,
  "ownership loss closes the reserved browser and cancels the returned old flow",
);
assert.match(source, /10 \* 60 \* 1000/, "OAuth polling is bounded to ten minutes");
assert.match(source, /window\.clearInterval/);
assert.match(source, /controller\.abort\(\)/, "polling stops on cleanup and unmount");
assert.match(
  source,
  /if \(!saved[\s\S]{0,180}setOauthAttempt\(null\)/,
  "a failed grant save stops polling instead of repeating the PATCH",
);

const reserveIndex = source.indexOf("reserveSystemBrowserWindow");
const startIndex = source.indexOf('fetch("/api/x/oauth/start"');
assert.ok(reserveIndex >= 0 && reserveIndex < startIndex, "the click reserves before guarded OAuth start");
assert.match(source, /cancelSystemBrowserOpen\(reservation\)/, "start failure closes a reserved window");
assert.match(source, /openSystemBrowser\(authorizationUrl, reservation\)/);
assert.match(
  source,
  /cancelXOAuthFlow\(pending\.flowId\)/,
  "post-start browser failures cancel only their server-side OAuth listener",
);
assert.match(oauthStartRoute, /export async function DELETE\(req: Request\)/);
assert.match(oauthStartRoute, /xOAuthService\.cancel\(flowId\)/);
assert.doesNotMatch(oauthStartRoute, /xOAuthService\.cancel\(\)/);

assert.match(brain, /import \{ FamiliarXSection \} from "@\/components\/familiar-x-section"/);
assert.match(
  brain,
  /<FamiliarAsanaSection familiar=\{familiar\} \/>\s*<FamiliarXSection familiar=\{familiar\} \/>/,
  "X settings render beside Asana",
);
assert.match(types, /xResearchEnabled\?: boolean/);
assert.match(types, /xPublishEnabled\?: boolean/);
assert.match(familiarRoute, /xResearchEnabled: configEntry\.xResearchEnabled === true/);
assert.match(familiarRoute, /xPublishEnabled: configEntry\.xPublishEnabled === true/);

assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, "stylesheet uses theme tokens");
assert.doesNotMatch(css, /\b(?:rgb|hsl|oklch)\(/i, "stylesheet does not hardcode colors");
assert.doesNotMatch(css, /\b\d+px\b/, "stylesheet uses spacing, type, radius, and border tokens");

console.log("familiar-x-section.test.ts: ok");
