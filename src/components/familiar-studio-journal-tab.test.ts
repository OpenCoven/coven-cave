// @ts-nocheck
// Journal lives in the Familiar Studio (Settings → Familiars → Journal).
// Source-scan invariants for the tab wiring and the redirect from the old
// top-level Journal surface.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const ctx = read("../lib/familiar-studio-context.tsx");

// ── Studio context knows the journal tab ─────────────────────────────────────
assert.match(ctx, /"journal"/, "FamiliarStudioTab union includes journal");
assert.match(
  ctx,
  /STUDIO_TABS[\s\S]*?"journal"/,
  "the persisted-tab restore guard accepts journal",
);
// One shared redirect helper: workspace surfaces and the redirecting provider
// both route through it, so the tab/familiar handoff keys can't drift.
assert.match(
  ctx,
  /export function openFamiliarStudioSettingsTab\(/,
  "context exports the settings-redirect helper",
);
assert.match(
  ctx,
  /openFamiliarStudioSettingsTab\(tab, id\)/,
  "the redirecting provider reuses the helper",
);

console.log("familiar-studio-journal-tab.test.ts: ok");
