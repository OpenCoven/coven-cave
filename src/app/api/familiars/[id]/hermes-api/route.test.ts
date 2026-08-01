// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const card = await readFile(
  new URL("../../../../../components/familiar-hermes-api-card.tsx", import.meta.url),
  "utf8",
);
const brainTab = await readFile(
  new URL("../../../../../components/familiar-studio-brain-tab.tsx", import.meta.url),
  "utf8",
);

// ── the key never comes back out ───────────────────────────────────────────
// This route writes a bearer credential. The read path must stay a state
// report; the moment it can echo the value, every client that renders the
// settings card has a copy of the key in its memory and its network log.

assert.doesNotMatch(
  route,
  /getLocalEncryptedSecret|resolveSecret|resolveVaultManagedSecret/,
  "the Hermes API route must never read the stored key back — GET reports state, not values",
);
assert.match(
  route,
  /hermesApiSetupState\(\{[\s\S]*?keyConfigured:[\s\S]*?keyGrantedToFamiliar:/,
  "the render state must describe the key by presence and grant, never by value",
);

// ── every verb is local-only ───────────────────────────────────────────────
for (const verb of ["GET", "PUT", "DELETE"]) {
  const handler = new RegExp(
    `export async function ${verb}\\([\\s\\S]{0,400}?rejectNonLocalRequest\\(req\\)`,
  );
  assert.match(
    route,
    handler,
    `${verb} must reject non-local callers before touching credential configuration`,
  );
}

// ── validate before you write ──────────────────────────────────────────────
// A save that stored the key and then rejected the endpoint would leave a
// credential on disk serving a transport that cannot run.
assert.match(
  route,
  /hermesApiUrlRejection\(rawUrl\)[\s\S]*?status: 400[\s\S]*?setLocalEncryptedSecret/,
  "the endpoint must be validated before the key is written",
);

// ── a new key is born scoped, never shared ─────────────────────────────────
// grantVaultScope never widens, so on an absent (== "shared") scope it returns
// "shared" — which would hand a brand-new credential to every familiar.
assert.match(
  route,
  /scope: existing \? grantVaultScope\(existing\.scope, id\) : \[id\]/,
  "a key created from the per-familiar form must be scoped to that familiar, not shared",
);

// ── disconnect revokes, it does not delete ─────────────────────────────────
assert.match(
  route,
  /export async function DELETE[\s\S]*?revokeVaultScope\(existing\.scope, id\)/,
  "disconnecting one familiar must revoke its grant, not destroy a key other familiars still use",
);
assert.doesNotMatch(
  route,
  /export async function DELETE[\s\S]*?deleteLocalEncryptedSecret/,
  "disconnecting one familiar must not delete the shared secret",
);

// ── the card ───────────────────────────────────────────────────────────────

assert.match(
  card,
  /type="password"/,
  "the API key field must be a password input",
);
assert.match(
  card,
  /setDraftKey\(""\)/,
  "the key field must never be repopulated from the server — there is no value to repopulate it with",
);
assert.match(
  card,
  /state\.blockedByProfile \?[\s\S]*?bound to a Hermes profile/,
  "a profile-bound familiar must be told its Hermes API settings will sit unused",
);
assert.match(
  card,
  /const urlChanged = draftUrl\.trim\(\) !== state\.url/,
  "Save must key on change, not emptiness, or clearing the endpoint becomes impossible",
);

assert.match(
  brainTab,
  /harnessId === "hermes" \? <FamiliarHermesApiCard familiarId=\{familiar\.id\} \/> : null/,
  "the Hermes API card belongs to Hermes familiars only",
);

console.log("hermes-api route tests passed");
