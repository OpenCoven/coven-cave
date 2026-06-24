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

// ── API exposes the supreme familiar so the UI can lock it on ────────────────
assert.match(
  route,
  /supremeFamiliarId: config\.supremeFamiliarId/,
  "the grants GET returns the supreme familiar id",
);

console.log("settings-permissions.test.ts: ok");
