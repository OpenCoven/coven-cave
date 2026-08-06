// @ts-nocheck
//
// The fullscreen familiar card (cave-3rz.2).
//
// The load-bearing guard in this file is the LAST one: a walk of the overlay's
// whole import graph asserting that nothing reachable from it can spawn a
// harness or call the scry. Opening a card must render an identity that already
// exists; if it could re-derive one, looking at a familiar would cost tokens and
// could quietly change what the familiar IS. A comment saying so is not enough —
// this makes it a build failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "..");
const read = (rel) => readFileSync(path.join(here, rel), "utf8");

/**
 * Comments out, code only.
 *
 * The whole point of the guards below is that the module cannot REACH the scry,
 * and every one of these files documents that fact in prose — so a naive scan
 * over the raw text fails on the sentences explaining why it passes. `//` after
 * a colon is left alone so URLs survive.
 */
const codeOnly = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const overlay = read("./familiar-card-overlay.tsx");
const trigger = read("./familiar-card-trigger.tsx");
const preview = read("./familiar-card-preview.tsx");
const avatar = read("./familiar-avatar.tsx");
const hook = readFileSync(path.join(srcRoot, "lib/use-familiar-card.ts"), "utf8");
const store = readFileSync(path.join(srcRoot, "lib/cave-familiar-foil.ts"), "utf8");
const css = readFileSync(path.join(srcRoot, "styles/familiar-card.css"), "utf8");

test("the card is opened from the avatar and dismissed the way every dialog is", () => {
  assert.match(trigger, /aria-label=\{`Open \$\{familiar\.display_name\}'s card`\}/, "the trigger says what it opens");
  assert.match(trigger, /aria-haspopup="dialog"/, "the trigger announces a dialog");
  // Lazy: an avatar renders on nearly every surface, and the card drags in the
  // foil pipeline and a QR encoder behind it.
  assert.match(trigger, /dynamic\(\s*\(\) => import\("@\/components\/familiar-card-overlay"\)/, "the overlay loads on first open");

  assert.match(overlay, /useFocusTrap\(open, dialogRef, \{ onEscape: onClose \}\)/, "focus trapped while open, Escape closes");
  assert.match(overlay, /className="famcard-full"[\s\S]{0,80}?onClick=\{onClose\}/, "a click on the backdrop closes");
  assert.match(overlay, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/, "a click on the card itself does not");
  assert.match(overlay, /role="dialog"[\s\S]{0,40}?aria-modal="true"/, "it is a modal dialog");
  assert.match(overlay, /createPortal\(/, "portalled out of the avatar's stacking context");
});

test("the card RENDERS the stored identity and never re-derives one", () => {
  // Every field on the face traces to the stored record.
  for (const field of [
    /name=\{familiar\.display_name\}/,
    /role=\{familiar\.role\}/,
    /description=\{familiar\.description\}/,
    /model=\{familiar\.model\}/,
  ]) {
    assert.match(overlay, field, `card field reads stored data: ${field}`);
  }
  // The aura is the STORED override. This is the one that would drift.
  assert.match(hook, /aura: familiar\?\.color \?\? null/, "aura comes from the stored color override");
  assert.doesNotMatch(codeOnly(hook), /extractAura/, "the card never re-samples an aura from the pixels");
  assert.doesNotMatch(codeOnly(overlay), /extractAura/, "the overlay never re-samples an aura either");
});

test("the foil plate is reused, and rebuilt only when the portrait moved under it", () => {
  assert.match(hook, /usableFamiliarFoil\(/, "a stored plate is read before anything is computed");
  assert.match(hook, /if \(stored\) return; \/\/ a usable plate already exists/, "a usable plate is never re-cut");
  assert.match(hook, /seed: familiarId/, "a rebuilt plate is seeded by the familiar, so it is the same plate every time");
  assert.match(store, /sourceKey/, "staleness is keyed to the avatar source");
  // The rite stores the plate it already struck, so a first open reuses it.
  const rite = read("./familiar-rite.tsx");
  assert.match(rite, /setFamiliarFoil\(newId, \{ dataUrl: conjure\.plateUrl \}\)/, "summoning persists the plate it struck");
  // …and every portrait writer retires it.
  const upload = readFileSync(path.join(srcRoot, "lib/familiar-image-upload.ts"), "utf8");
  assert.match(upload, /clearFamiliarFoil\(familiarId\)/, "a replaced Cave-local portrait retires the plate");
  const circle = read("./familiar-summoning-circle.tsx");
  assert.match(circle, /clearFamiliarFoil\(familiar\.id\)/, "a replaced workspace portrait retires the plate");
});

test("spin shares the card with the gestures that were already on it", () => {
  assert.match(preview, /const SPIN_SLOP_PX = 6;/, "a press is a flip until it travels");
  assert.match(preview, /swallowClickRef\.current = true;/, "a press that spun does not also flip");
  assert.match(
    preview,
    /if \(swallowClickRef\.current\) \{\s*swallowClickRef\.current = false;\s*return;\s*\}\s*setFlipped/,
    "the flip is what the click still does otherwise",
  );
  // Two switches: the GESTURE stays split in both modes, only the MOTION goes.
  // Collapsing them would make a drag under reduced motion land as a click and
  // flip the card — a gesture nobody made.
  assert.match(preview, /const dragArmed = Boolean\(spinnable\);/, "the drag/click split is not conditional on motion");
  assert.match(preview, /const spinning = dragArmed && !reducedMotion;/, "no rotation and no spring under reduced motion");
  assert.match(preview, /drag\.travelled = true;\s*if \(!spinning\) return;/, "a travelled press is recognised under reduced motion, and simply does not rotate");
  assert.match(preview, /if \(spinning\) releaseSpin\(drag\.velX, drag\.velY\);/, "no release momentum under reduced motion");
  assert.match(preview, /KEY_SPIN\[ev\.key\]/, "spin is reachable from the keyboard");
  // Reduced motion must not leave the card frozen at whatever angle it held.
  assert.match(preview, /if \(spinning\) return;\s*stopSpring\(\);\s*spinRef\.current = \{ x: 0, y: 0 \};/, "turning spin off returns the card face-on");
  assert.match(css, /\.famcard--spinnable \{[^}]*touch-action: none/, "a spinnable card claims the touch gesture");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.famcard--spinnable \{ cursor: pointer; \}/, "and does not advertise a grab it will not honour");
  assert.match(css, /\.famcard-slot--full \{/, "the fullscreen card sizes off the viewport");
  // Past edge-on the flip alone nominates the wrong face, and the card paints
  // its own front mirrored. Which face shows is recomputed from the live angle.
  assert.match(preview, /const showsBack = facing > 90 && facing < 270;/, "the facing face is derived from the real angle");
  assert.match(preview, /classList\.toggle\("famcard--reversed", showsBack !== flipped\)/, "…and inverts the flip when they disagree");
  assert.match(css, /\.famcard--flipped\.famcard--reversed \.famcard__face--front \{ visibility: visible; \}/, "the inversion outranks the flip");
  assert.match(css, /\.famcard--turning \.famcard__face \{ transition: none; \}/, "a JS-driven turn swaps faces immediately");
});

test("the familiar's own profile opens the card; every other avatar keeps the lightbox", () => {
  assert.match(avatar, /if \(asCard && hasImage && resolvedSrc\) \{/, "asCard is opt-in and needs a portrait");
  assert.match(avatar, /if \(expandable && hasImage && resolvedSrc\) \{/, "the shared lightbox is untouched underneath it");
  const profile = read("./chat-familiar-capabilities.tsx");
  assert.match(profile, /<FamiliarAvatar familiar=\{resolved\} size="xl" expandable asCard \/>/, "the profile hero opens the card");
  // The Studio header's avatar used to be the file picker. The picker moved to
  // its own control; the drop path is unchanged.
  const studio = read("./familiar-studio-inline.tsx");
  assert.match(studio, /className="familiar-studio-control__avatar-edit focus-ring"[\s\S]{0,200}?onClick=\{\(\) => inputRef\.current\?\.click\(\)\}/, "replacing a portrait is its own labelled control");
  assert.match(studio, /onDrop=\{dropAvatar\}/, "dropping an image on the avatar still replaces it");
  assert.match(studio, /onClick=\{\(\) => setCardOpen\(true\)\}/, "the avatar's own click opens the card");
});

// ── The structural guarantee ────────────────────────────────────────────────

/** Resolve one import specifier to a file under src/, or null if it leaves. */
function resolveSpecifier(fromFile, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(srcRoot, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // node_modules / bare specifier
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep) && candidate.match(/\.tsx?$/)) return candidate;
  }
  return null;
}

/** Value imports only — `import type` is erased and reaches no runtime code. */
function valueImports(source) {
  const found = [];
  const re = /^\s*import\s+(?!type\s)([\s\S]*?)from\s*"([^"]+)"/gm;
  let m;
  while ((m = re.exec(source))) found.push(m[2]);
  // Dynamic `import("…")` counts: it still reaches the module at runtime.
  const dyn = /import\(\s*"([^"]+)"\s*\)/g;
  while ((m = dyn.exec(source))) found.push(m[1]);
  return found;
}

test("nothing reachable from the card can spawn a harness or call the scry", () => {
  const seen = new Set();
  const queue = [
    path.join(here, "familiar-card-overlay.tsx"),
    path.join(here, "familiar-card-trigger.tsx"),
  ];
  const offenders = [];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = codeOnly(readFileSync(file, "utf8"));
    const rel = path.relative(srcRoot, file);
    // The scry is a MODEL inventing an identity. Recomputing the foil plate is
    // arithmetic over pixels on a canvas and is explicitly fine — that is the
    // whole distinction this guard exists to hold.
    for (const banned of [
      /\/api\/scry/,
      /\/api\/chat\/send/,
      /streamFamiliarText/,
      /spawnHarness|harnessSpawn/,
    ]) {
      if (banned.test(source)) offenders.push(`${rel} matches ${banned}`);
    }
    for (const spec of valueImports(source)) {
      const resolved = resolveSpecifier(file, spec);
      if (resolved) queue.push(resolved);
    }
  }
  assert.ok(seen.size > 6, `the walk should reach the card's real dependencies, saw ${seen.size}`);
  assert.deepEqual(offenders, [], "opening a card must not be able to reach a model");
});

console.log("familiar-card-overlay.test.ts: ok");
