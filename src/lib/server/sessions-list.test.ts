// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const helper = readFileSync(new URL("./sessions-list.ts", import.meta.url), "utf8");
const route = readFileSync(
  new URL("../../app/api/sessions/list/route.ts", import.meta.url),
  "utf8",
);

assert.match(
  helper,
  /export async function computeSessionsList\(/,
  "the reusable server helper exports session computation",
);
assert.match(
  helper,
  /if \(!collapseFamiliarWorkspace\) return sessions;/,
  "the reusable helper preserves the collapse fast path",
);
assert.equal(
  (helper.match(/applyFamiliarWorkspaceCollapse\(/g) || []).length,
  3,
  "the helper applies collapse in both healthy and degraded branches",
);
assert.match(
  helper,
  /hasActiveChatRun\(conv\.sessionId\)/,
  "pending local conversations retain live-run truth",
);
assert.doesNotMatch(
  helper,
  /sessionsListCache/,
  "the reusable compute helper does not own the route cache",
);
assert.match(
  route,
  /loadCachedSessionsList\(\s*includeArchived,\s*familiarId,\s*collapseFamiliarWorkspace,\s*\)/,
  "the route delegates reads through the shared cached wrapper",
);

console.log("sessions-list.test.ts: ok");
