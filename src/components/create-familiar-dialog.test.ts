// @ts-nocheck
//
// Source-text guards for the "New familiar" dialog. Keeps the contract light
// (no React render harness) while pinning the behaviours that matter: it posts
// to the create route, derives a live id, blocks duplicates, and sources its
// harness list and glyphs from the shared catalogs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./create-familiar-dialog.tsx", import.meta.url), "utf8");

// Built on the shared Modal primitive (focus trap + escape come for free).
assert.match(source, /from "@\/components\/ui\/modal"/, "dialog should use the shared Modal");
assert.match(source, /breadcrumb=\{\["Familiars", "New familiar"\]\}/, "dialog header should read Familiars › New familiar");

// Creates via POST /api/familiars (the new write path), not onboarding/setup.
assert.match(
  source,
  /fetch\("\/api\/familiars",\s*\{[\s\S]*?method:\s*"POST"/,
  "dialog should POST to /api/familiars",
);
assert.doesNotMatch(source, /onboarding\/setup/, "dialog should not call the onboarding setup route");

// Live id preview uses the same slugifier the server applies, so what the user
// sees matches what gets persisted.
assert.match(
  source,
  /slugifyFamiliarId\(idOverride \?\? name\)/,
  "dialog should derive the id preview with slugifyFamiliarId",
);

// Duplicate ids are blocked before submit.
assert.match(source, /idTaken/, "dialog should compute whether the derived id is taken");
assert.match(
  source,
  /const canCreate =[\s\S]*?!idTaken/,
  "Create must be disabled when the id is already taken",
);

// Harness options come from the shared adapter catalog (not a hardcoded list).
assert.match(
  source,
  /COMPATIBILITY_ADAPTERS\.map\(/,
  "harness dropdown should be built from COMPATIBILITY_ADAPTERS",
);

// Optional fields are only sent when filled (keeps the payload clean / lets the
// server apply its defaults).
assert.match(source, /role\.trim\(\) \?/, "role should be sent only when provided");
assert.match(source, /model\.trim\(\) \?/, "model should be sent only when provided");
assert.match(source, /description\.trim\(\) \?/, "description should be sent only when provided");

// Icon picker renders through the free-form glyph renderer (not the strict
// chrome <Icon>), so any Phosphor glyph displays.
assert.match(source, /FamiliarGlyph/, "dialog should render glyph swatches with FamiliarGlyph");

// Optional avatar upload: a file input feeds an object-URL preview, and the
// image is POSTed to the avatar route AFTER the familiar exists (it's keyed by
// id). The upload is best-effort so it never blocks creation.
assert.match(source, /type="file"/, "dialog should offer a file input for an avatar");
assert.match(
  source,
  /fetch\(`\/api\/familiars\/\$\{encodeURIComponent\(newId\)\}\/avatar`/,
  "dialog should upload the avatar to the per-familiar avatar route after create",
);
assert.match(source, /if \(avatarFile\)/, "avatar upload should only run when an image was chosen");
// The selected file is confirmed by name (no <img> sink — avoids rendering a
// file-derived object URL, which CodeQL flags as DOM-XSS; the real avatar shows
// on the roster card after create via the server-origin GET route).
assert.doesNotMatch(source, /<img\b/, "dialog must not render the picked file as an <img>");
assert.match(source, /Photo attached/, "dialog should confirm an attached photo by name");

console.log("create-familiar-dialog.test.ts: ok");
