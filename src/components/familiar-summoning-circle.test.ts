// @ts-nocheck
//
// Source-text guards for the Familiar Summoning Circle — the app's one
// creation-and-enhancement ritual for familiars. Pins the contracts that
// matter: it posts to the create route (not onboarding), carries all three
// connection vessels (local runtime, SSH remote, OpenClaw agent), derives a
// live id, blocks duplicates, batches enhancement through the shipped
// persistence paths, and keeps the a11y + reduced-motion story intact.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("./familiar-summoning-circle.tsx", import.meta.url),
  "utf8",
);
const css = await readFile(
  new URL("../styles/summoning-circle.css", import.meta.url),
  "utf8",
);

// ── Creation posts to the app route, never the onboarding one ───────────────
assert.match(
  source,
  /fetch\("\/api\/familiars",\s*\{[\s\S]*?method:\s*"POST"/,
  "the circle should POST to /api/familiars",
);
assert.doesNotMatch(
  source,
  /onboarding\/setup/,
  "the circle must not call the onboarding setup route",
);

// ── All three vessels (connection paths) ────────────────────────────────────
assert.match(
  source,
  /type VesselKind = "local" \| "ssh" \| "openclaw"/,
  "the vessel choice covers local, SSH, and OpenClaw",
);
assert.match(
  source,
  /fetch\("\/api\/harnesses"/,
  "local/SSH vessels list installed runtimes from /api/harnesses",
);
assert.match(
  source,
  /fetch\("\/api\/openclaw-agents"/,
  "the OpenClaw vessel discovers agents from /api/openclaw-agents",
);
assert.match(
  source,
  /fetch\("\/api\/onboarding\/ssh-check"/,
  "SSH connections are testable before summoning",
);
assert.match(
  source,
  /runtime: \{\s*\n\s*kind: "ssh",\s*\n\s*host: sshHost\.trim\(\),\s*\n\s*cwd: sshCwd\.trim\(\),/,
  "summoning a remote familiar sends the ssh runtime to the create route",
);
assert.match(
  source,
  /openclawAgentId: selectedAgent\.id/,
  "summoning from an OpenClaw agent sends openclawAgentId",
);
assert.match(
  source,
  /never stores passwords or key material/,
  "SSH copy stays explicit that Cave holds no secrets",
);

// ── Identity: live id, duplicate guard, name dice ────────────────────────────
assert.match(
  source,
  /slugifyFamiliarId\(idOverride \?\? name\)/,
  "the id preview derives from the same slugifier the server applies",
);
assert.match(source, /idTaken/, "the circle computes whether the derived id is taken");
assert.match(
  source,
  /const descriptionComplete = description\.trim\(\)\.length > 0/,
  "the circle requires a non-empty familiar description",
);
assert.match(
  source,
  /const identityComplete = nameComplete && descriptionComplete/,
  "the identity stage requires both name and description",
);
assert.match(
  source,
  /disabled=\{!vesselComplete \|\| !identityComplete \|\| idTaken \|\| submitting\}/,
  "Summon must be disabled when the id is taken or a required description is missing",
);
assert.match(
  source,
  /description: description\.trim\(\)/,
  "the circle always sends the required description to the creation route",
);
assert.match(
  source,
  /htmlFor="summon-description">What it does \*</,
  "the description input is visibly required",
);
assert.match(source, /NAME_POOL/, "the name stage offers suggested names");
{
  const poolMatch = source.match(/const NAME_POOL = \[([\s\S]*?)\] as const;/);
  assert.ok(poolMatch, "NAME_POOL should stay a literal array so reserved-name filtering is reviewable");
  const poolSource = poolMatch[1] ?? "";
  for (const reserved of ["Nova", "Kitty", "Cody", "Sage", "Astra", "Echo", "Salem"]) {
    assert.doesNotMatch(
      poolSource,
      new RegExp(`"${reserved}"`),
      `name dice must not suggest internal Coven familiar name ${reserved}`,
    );
  }
}
assert.doesNotMatch(
  source,
  /placeholder="e\.g\. Nova"/,
  "the default name example must not show an internal Coven familiar name",
);
assert.doesNotMatch(
  source,
  /Math\.random\(\) \* pool\.length\)\] \?\? "Nova"/,
  "empty suggestion fallback must not use an internal Coven familiar name",
);

// ── Form: shared glyph component, best-effort adornments ────────────────────
assert.match(
  source,
  /FamiliarGlyph glyph=\{\{ kind: "icon", name: g \}\}/,
  "starter sigils render through the shared FamiliarGlyph",
);
assert.match(
  source,
  /\/api\/familiars\/\$\{encodeURIComponent\((newId|familiar\.id)\)\}\/avatar/,
  "portraits upload to the familiar avatar route",
);
assert.match(
  source,
  /non-blocking/,
  "a failed avatar upload must not undo a successful summoning",
);

// ── Enhancement rite: shipped persistence paths, batched apply ──────────────
assert.match(
  source,
  /setFamiliarOverride\(familiar\.id/,
  "identity/aura enhancements ride the Cave override store",
);
assert.match(
  source,
  /setGlyphOverride\(familiar\.id/,
  "sigil enhancements ride the glyph override store (same as the Studio picker)",
);
assert.match(
  source,
  /fetch\("\/api\/config",\s*\{\s*\n\s*method: "PATCH"/,
  "model enhancements PATCH /api/config like the Studio Brain tab",
);
assert.match(
  source,
  /export function vitalityFor/,
  "enhancement vitality derives from live roster fields",
);
assert.doesNotMatch(
  source,
  /\bxp\b|experience points|level up/i,
  "vitality stays honest — no invented XP mechanics",
);

// ── A11y: trap, announcer, roles ─────────────────────────────────────────────
assert.match(source, /useFocusTrap\(true, dialogRef, \{ onEscape: handleClose \}\)/, "the circle traps focus and closes on Escape");
assert.match(source, /useAnnouncer\(\)/, "the circle announces through the shared live region");
assert.match(
  source,
  /has answered the summons/,
  "a successful summoning is announced to assistive tech",
);
assert.match(
  source,
  /grows stronger/,
  "a completed enhancement is announced to assistive tech",
);
assert.match(source, /role="alert"/, "failures render as alerts");
assert.match(source, /aria-current=\{stage === i && !summoned \? "step" : undefined\}/, "the active rite is exposed as the current step");

// ── The circle visualization: decorative, reduced-motion story at birth ─────
assert.match(source, /aria-hidden/, "the circle SVG is decorative — the stepper carries progress");
assert.match(
  css,
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/,
  "the orbit and flare collapse under prefers-reduced-motion",
);
assert.match(
  css,
  /--sc-accent: var\(--accent-presence\)/,
  "the circle accent falls back to the presence token",
);
assert.doesNotMatch(
  css,
  /#[0-9a-fA-F]{3,8}\b/,
  "summoning-circle.css uses tokens, not hardcoded hex colors",
);

// ── Long vessel lists scroll INSIDE the panel (cave-hpsz) ────────────────────
// With ~12 OpenClaw agents the list used to blow past the dialog's max-height
// and paint through the Cancel/Continue footer: the panel was the scroller,
// so flexbox shrank __content and its overflow escaped. The content is the
// one scroller; the panel clips; the grid row may shrink below its content.
assert.match(
  css,
  /\.summoning-panel \{[^}]*overflow: hidden;/,
  "the panel clips — heading and footer stay pinned",
);
assert.match(
  css,
  /\.summoning-panel__content \{[^}]*overflow-y: auto;/,
  "the stage content is the one scroller",
);
assert.match(
  css,
  /\.summoning-layout \{[^}]*grid-template-rows: minmax\(0, 1fr\);/s,
  "the layout row can shrink below a long vessel list",
);

// ── The circle is the only creation path (dialog fully replaced) ────────────
const familiarsView = await readFile(new URL("./familiars-view.tsx", import.meta.url), "utf8");
const settingsShell = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");
for (const [name, consumer] of [["familiars-view", familiarsView], ["settings-shell", settingsShell]]) {
  assert.match(
    consumer,
    /FamiliarSummoningCircle/,
    `${name} opens the summoning circle`,
  );
  assert.doesNotMatch(
    consumer,
    /CreateFamiliarDialog/,
    `${name} no longer references the retired CreateFamiliarDialog`,
  );
}
assert.match(
  familiarsView,
  /onEnhance=\{\(\) => setEnhanceTarget\(selectedFamiliar\)\}/,
  "the familiar detail panel opens the Enhancement Rite",
);

console.log("familiar-summoning-circle.test.ts: ok");
