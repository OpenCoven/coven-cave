// @ts-nocheck
//
// Source-text guards for the Summoning Rite — the default Summon path
// (cave-3rz.3). Pins the parts that are contracts rather than styling: the rite
// actually creates a familiar through the shipped create route, its adornments
// stay best-effort, the seal ends up encoding the REAL familiar id, and the
// advanced vessels the rite cannot express still have a way out to the
// Summoning Circle.
//
// Same shape as familiar-summoning-circle.test.ts, and for the same reason: a
// regression here is a rite that looks finished and creates nothing, which no
// render test in this repo would catch either.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rite = await readFile(new URL("./familiar-rite.tsx", import.meta.url), "utf8");
const view = await readFile(new URL("./familiars-view.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/familiar-rite.css", import.meta.url), "utf8");

// ── The seal actually summons ───────────────────────────────────────────────
assert.match(
  rite,
  /fetch\("\/api\/familiars",\s*\{[\s\S]*?method:\s*"POST"/,
  "the rite must POST to the create route — an inert Summon is the whole bug this fixes",
);
assert.doesNotMatch(
  rite,
  /onboarding\/setup/,
  "the rite must not call the onboarding setup route",
);
assert.match(
  rite,
  /onClick=\{\(\) => void handleSummon\(\)\}/,
  "the Summon button must be wired to the summoning",
);

// `POST /api/familiars` rejects an empty description with a 400, and the rite
// promises every step after the likeness is skippable. Both can only be true
// if the skip has a default.
assert.match(
  rite,
  /const DEFAULT_DESCRIPTION = /,
  "a skipped description needs a defensible default, not a 400",
);
assert.match(
  rite,
  /description:\s*description\.trim\(\) \|\| DEFAULT_DESCRIPTION/,
  "the description default must be applied at the create call",
);
assert.match(
  rite,
  /const harness = vessel \?\? defaultHarness \?\? FALLBACK_HARNESS/,
  "a skipped vessel must still resolve to a real harness",
);

// ── Adornments are best-effort, exactly as the circle has them ──────────────
// The familiar exists by the time these run, so a failed portrait or aura must
// never undo a successful summoning.
assert.match(
  rite,
  /fetch\(`\/api\/familiars\/\$\{encodeURIComponent\(newId\)\}\/avatar`/,
  "the dropped likeness must be uploaded as the familiar's avatar",
);
assert.match(
  rite,
  /try \{\s*await fetch\(`\/api\/familiars\/\$\{encodeURIComponent\(newId\)\}\/avatar`[\s\S]*?\} catch \{[\s\S]*?\}/,
  "the avatar upload must be best-effort — it runs after the familiar exists",
);
assert.match(
  rite,
  /try \{\s*setFamiliarOverride\(newId,[\s\S]*?\} catch \{[\s\S]*?\}/,
  "the override write must be best-effort for the same reason",
);
assert.match(
  rite,
  /color: conjure\.aura/,
  "the aura sampled from the likeness must be persisted",
);
assert.match(
  rite,
  /familiarType: types\.join\(","\)/,
  "the chosen offices must be persisted as the familiar's type(s)",
);

// ── The seal encodes the id the daemon gave, not a guess ────────────────────
assert.match(
  rite,
  /summoned\s*\?\s*`\$\{SEAL_ORIGIN\}\$\{summoned\.id\}`/,
  "once the familiar exists the seal must encode its real id",
);
assert.match(
  rite,
  /const newId = json\.id \?\? derivedId;/,
  "the created id comes from the route's response",
);

// ── The circle stays reachable for the vessels the rite cannot express ──────
// The rite offers five local harnesses. SSH hosts, OpenClaw agents and Hermes
// profiles are still the circle's, so making the rite the default must not
// strand anyone who needs one.
assert.match(
  rite,
  /onSummonByHand\?: \(\) => void;/,
  "the rite must accept a way out to the summoning circle",
);
assert.match(
  rite,
  /current\.key === "vessel" && onSummonByHand/,
  "the way out belongs on the vessel step, where the gap is discovered",
);
assert.match(
  rite,
  /Summon by hand/,
  "the overlay chrome must offer the escape from every step",
);
assert.match(
  view,
  /<FamiliarRiteOverlay[\s\S]*?open=\{createOpen\}/,
  "Summon must open the rite",
);
assert.match(
  view,
  /onSummonByHand=\{\(\) => \{\s*setCreateOpen\(false\);\s*setByHandOpen\(true\);\s*\}\}/,
  "the rite's escape must hand the summoning to the circle",
);
assert.match(
  view,
  /<FamiliarSummoningCircle[\s\S]*?open=\{byHandOpen \|\| enhanceTarget !== null\}/,
  "the circle stays mounted for by-hand summoning and for the enhancement rite",
);

// ── The overlay defends the one thing no draft can restore ──────────────────
// The rite deliberately keeps NO sessionStorage draft: its required input is a
// File, which cannot be serialized, and restoring the answers without the
// likeness rebuilds a rite that cannot summon. So the gesture is defended
// instead — the backdrop must not close it, and Escape asks first.
assert.doesNotMatch(
  rite,
  /from "@\/lib\/summoning-draft"|window\.sessionStorage/,
  "the rite must not pretend it can persist a dropped File",
);
assert.match(
  rite,
  /<div className="rite-backdrop" role="presentation">/,
  "the backdrop carries no click handler — a stray click must not discard the rite",
);
assert.doesNotMatch(
  rite,
  /className="rite-backdrop"[^>]*onClick/,
  "the backdrop must not close the rite",
);
assert.match(
  rite,
  /useFocusTrap\(true, dialogRef, \{ onEscape: requestClose \}\)/,
  "Escape must route through the confirm, not straight to onClose",
);
assert.match(
  rite,
  /role="alertdialog"/,
  "leaving mid-rite must ask before discarding",
);

// ── Arrows walk the rite, but never out from under a caret ─────────────────
// The seal step is three text inputs. A window-level Left/Right that ignores
// the focused element means correcting a typo in the name navigates away and
// unmounts the field mid-edit — verified against the running app before this
// guard existed.
assert.match(
  rite,
  /target\?\.isContentEditable \|\|\s*\/\^\(input\|textarea\|select\)\$\/i\.test\(target\?\.tagName \?\? ""\)/,
  "arrow-key navigation must stand down while a field has focus",
);

// ── Styling stays on tokens ────────────────────────────────────────────────
assert.doesNotMatch(
  css.split("/* ── The rite as an overlay")[1] ?? "",
  /#[0-9a-fA-F]{3,8}\b/,
  "the overlay must not introduce raw hex colours",
);
assert.match(css, /\.rite-backdrop \{[\s\S]*?background: var\(--backdrop-scrim\);/, "the overlay uses the shared scrim token");

console.log("familiar-rite: ok");
