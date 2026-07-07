// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tab = readFileSync(new URL("./familiar-studio-projects-tab.tsx", import.meta.url), "utf8");
const inline = readFileSync(new URL("./familiar-studio-inline.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const context = readFileSync(new URL("../lib/familiar-studio-context.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/project-grants/route.ts", import.meta.url), "utf8");

// ── Permissions moved INTO the per-familiar studio as a Projects tab ─────────
assert.match(tab, /export function FamiliarStudioProjectsTab/, "exports the per-familiar Projects tab");
assert.match(context, /"projects"/, "studio tab union includes projects");
assert.match(inline, /id: "projects", label: "Projects"/, "inline studio exposes a Projects tab");
assert.match(
  inline,
  /activeTab === "projects" \? <FamiliarStudioProjectsTab familiar=\{familiar\} \/>/,
  "inline studio renders the Projects tab body for the selected familiar",
);

// ── The standalone Settings → Permissions section is gone ────────────────────
assert.doesNotMatch(shell, /PermissionsSection/, "shell no longer mounts a standalone Permissions section");
assert.doesNotMatch(shell, /id: "permissions"/, "settings nav no longer lists a Permissions section");
assert.doesNotMatch(shell, /section === "permissions"/, "shell no longer routes a permissions section");

// ── Projects tab speaks the project-permissions protocol, scoped to one familiar ─
assert.match(tab, /fetch\("\/api\/projects"/, "loads projects");
assert.match(tab, /fetch\("\/api\/project-grants"/, "loads grants + supreme familiar + audit");
assert.match(tab, /fetch\("\/api\/grant-proposals"/, "loads the grant-proposal inbox");
// Toggling a project grants (POST) or revokes (DELETE) — sending ONLY this
// familiar + the project (the grant route rejects relayed approvals).
assert.match(tab, /method: next \? "POST" : "DELETE"/, "toggling on grants, off revokes");
assert.match(
  tab,
  /body: JSON\.stringify\(\{ targetFamiliarId: familiar\.id, projectId \}\)/,
  "grant changes send only the selected familiar + project (human-confirmed)",
);
assert.match(tab, /role="switch"/, "each project row is a switch");
// Proposals are resolved by id (PATCH), sending only the decision.
assert.match(tab, /\/api\/grant-proposals\/\$\{id\}/, "resolves a proposal by id");
assert.match(tab, /method: "PATCH"/, "proposal decisions are a PATCH");
assert.match(tab, /JSON\.stringify\(\{ decision \}\)/, "sends only the accept/reject decision");
// The supreme (all-access) familiar is surfaced, not toggle-able.
assert.match(tab, /isSupreme\(familiar\.id, supremeFamiliarId\)/, "marks the supreme (all-access) familiar");
assert.match(tab, /has access to every project/i, "explains the all-access familiar");
// Everything is filtered to THIS familiar.
assert.match(tab, /p\.targetFamiliarId === familiar\.id/, "requests are scoped to this familiar");
assert.match(tab, /e\.familiarId === familiar\.id/, "audit is scoped to this familiar");
assert.match(tab, /useUserProfile\(\)/, "grant source labels subscribe to profile hydration and renames");
assert.match(
  tab,
  /grantSourceMeta\(meta\.source, userDisplayName\(profileSnapshot\?\.profile\)\)/,
  "human grant source labels use the current operator profile display name",
);

// ── API still exposes the supreme familiar + a bounded recent audit window ───
assert.match(route, /supremeFamiliarId: config\.supremeFamiliarId/, "the grants GET returns the supreme familiar id");
assert.match(route, /listRecentPermissionAudit/, "the grants GET returns a recent audit window");

console.log("familiar-studio-projects-tab.test.ts: ok");
