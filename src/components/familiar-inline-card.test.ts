// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./familiar-inline-card.tsx", import.meta.url), "utf8");

assert.match(src, /export function FamiliarInlineCard/, "exports FamiliarInlineCard");

// Identity section: enlarged avatar + name + role + description
assert.match(src, /FamiliarAvatar/, "renders FamiliarAvatar");
assert.match(src, /size="xl"/, "uses xl avatar size");
assert.match(src, /display_name/, "shows display_name");
assert.match(src, /\.role/, "shows role");
assert.match(src, /description/, "shows description");

// Presence/status section
assert.match(src, /useFamiliarStatus/, "uses status hook");
assert.match(src, /statusMeta/, "maps status via statusMeta");
assert.match(src, /formatRelTime/, "formats last-seen");

// Quick actions: scope switch, studio, edit profile, new chat
assert.match(src, /openFamiliarStudio\(\s*familiar\.id\s*\)/, "Open Studio action");
assert.match(src, /openFamiliarStudio\(\s*familiar\.id\s*,\s*"identity"\s*\)/, "Edit profile → identity tab");
assert.match(src, /cave:familiar-select/, "Switch dispatches cave:familiar-select");
assert.match(src, /cave:agents-new-chat/, "New chat dispatches cave:agents-new-chat");

// Deep memory peek + view-all link
assert.match(src, /useFamiliarMemory/, "uses memory hook");
assert.match(src, /openFamiliarStudio\(\s*familiar\.id\s*,\s*"memory"\s*\)/, "View all → memory tab");

// a11y + dismiss affordance
assert.match(src, /aria-label="Close"/, "close button labelled");
assert.match(src, /onClose/, "accepts onClose");

// endpoints reused, not reinvented
assert.match(src, /\/api\/familiars/, "fetches /api/familiars");
assert.match(src, /\/api\/memory/, "fetches /api/memory");

// loading + empty handling for memory
assert.match(src, /No memory yet/, "empty memory state");

console.log("familiar-inline-card.test.ts: ok");
