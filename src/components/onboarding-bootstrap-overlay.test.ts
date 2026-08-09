// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = [
  await readFile(
    new URL("./onboarding-bootstrap-overlay.tsx", import.meta.url),
    "utf8",
  ),
  await readFile(new URL("../lib/onboarding-bootstrap.ts", import.meta.url), "utf8"),
].join("\n");
const lazy = await readFile(new URL("./lazy-surfaces.tsx", import.meta.url), "utf8");

assert.match(
  lazy,
  /import\("@\/components\/onboarding-bootstrap-overlay"\)/,
  "the workspace loads the one-confirmation bootstrap surface",
);
assert.equal(
  source.match(/>\s*Set up Cave\s*</g)?.length,
  2,
  "the heading and one primary confirmation use the approved action copy",
);
assert.match(
  source,
  /aria-label="Setup progress"/,
  "live stages render as one accessible progress list",
);
assert.match(
  source,
  /aria-current=\{state\.activeStage === stage\.id \? "step" : undefined\}/,
  "the running stage is exposed to assistive technology",
);
assert.match(
  source,
  /useFocusTrap\(open, dialogRef, \{ onEscape: dismiss \}\)/,
  "the modal traps and returns focus",
);
assert.match(
  source,
  /if \(!state\.confirmed\) persistDismissal\(\)/,
  "declining setup persists the first-run dismissal",
);
assert.match(
  source,
  /motion-safe:animate-spin/,
  "progress animation respects reduced-motion preferences",
);
assert.match(
  source,
  /useAnnouncer\(\)/,
  "stage changes and failures use the shared live region",
);
assert.match(
  source,
  /Provider sign-in is deferred until you first use a familiar/,
  "credential boundaries are explicit in first-run copy",
);
assert.match(
  source,
  /never asks for an administrator password/,
  "elevation boundaries are explicit in first-run copy",
);
assert.match(
  source,
  /Git is optional/,
  "Git remains visibly optional",
);
assert.doesNotMatch(
  source,
  /Node\.js|npm|Coven CLI|Codex|Claude|Copilot|OpenClaw|package/i,
  "first-run UI hides package and tool identities",
);

console.log("onboarding-bootstrap-overlay.test.ts: ok");
