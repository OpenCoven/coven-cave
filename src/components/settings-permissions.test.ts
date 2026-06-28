import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const perms = readFileSync(new URL("./settings-permissions.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/project-grants/route.ts", import.meta.url), "utf8");

// ── Settings wires a Permissions section ─────────────────────────────────────
assert.match(shell, /"permissions"/, "Section type includes permissions");
assert.match(
  shell,
  /\{ id: "permissions", label: "Permissions",/,
  "Settings nav lists a Permissions section",
);
assert.match(
  shell,
  /section === "permissions" && <PermissionsSection \/>/,
  "Settings renders the PermissionsSection",
);

// ── PermissionsSection: per-familiar project visibility, editable ────────────
assert.match(perms, /fetch\("\/api\/familiars"/, "loads familiars");
assert.match(perms, /fetch\("\/api\/projects"/, "loads projects");
assert.match(perms, /fetch\("\/api\/project-grants"/, "loads grants + supreme familiar");
// Toggling a project for a familiar grants (POST) or revokes (DELETE) — sending
// ONLY targetFamiliarId + projectId (the grant route rejects relayed approvals).
assert.match(
  perms,
  /method: next \? "POST" : "DELETE"/,
  "toggling on grants, off revokes",
);
assert.match(
  perms,
  /body: JSON\.stringify\(\{ targetFamiliarId: familiarId, projectId \}\)/,
  "grant changes send only target familiar + project (human-confirmed)",
);
assert.match(perms, /role="switch"/, "each project row is a switch");
// The supreme familiar is all-access and not toggle-able.
assert.match(perms, /fam\.id === supremeFamiliarId/, "marks the supreme (all-access) familiar");
assert.match(perms, /has access to every project/i, "explains the all-access familiar");

// ── Console exposes the whole protocol: Access / Requests / Audit tabs ───────
assert.match(perms, /id: "access"/, "has an Access (grant matrix) tab");
assert.match(perms, /id: "requests"/, "has a Requests (grant-proposal inbox) tab");
assert.match(perms, /id: "audit"/, "has an Audit (access-decision log) tab");

// Requests tab: the human resolves a grant proposal by id (PATCH), sending only
// the decision — never a relayed approval.
assert.match(perms, /fetch\("\/api\/grant-proposals"/, "loads the grant-proposal inbox");
assert.match(perms, /\/api\/grant-proposals\/\$\{id\}/, "resolves a proposal by id");
assert.match(perms, /method: "PATCH"/, "proposal decisions are a PATCH");
assert.match(perms, /JSON\.stringify\(\{ decision \}\)/, "sends only the accept/reject decision");

// Audit tab: renders the access-decision log from the grants GET `audit` window.
assert.match(perms, /filterAudit/, "renders the access audit log");

// ── API exposes the supreme familiar so the UI can lock it on ────────────────
assert.match(
  route,
  /supremeFamiliarId: config\.supremeFamiliarId/,
  "the grants GET returns the supreme familiar id",
);
// …and a bounded recent audit window for the console's Audit tab.
assert.match(route, /listRecentPermissionAudit/, "the grants GET returns a recent audit window");

console.log("settings-permissions.test.ts: ok");
