// @ts-nocheck
//
// Guard: creating a familiar through /api/onboarding/setup must NOT wipe
// the user's existing cave-config.json fields outside of {defaults, familiars}.
//
// Before this guard, the setup route reconstructed `nextConfig` with only
// {version, defaults, familiars} and then wrote it directly via writeFile.
// That silently nuked addons, roles, and marketplace.installed every time a
// user added a familiar from the onboarding overlay — a hidden data-loss bug
// for anyone who'd toggled add-ons on or installed marketplace plugins.
//
// We assert against the source string (matches existing route-test pattern;
// see src/app/api/onboarding/install/route.test.ts and
// src/app/api/skills/local/route.test.ts) so the guard stays light and doesn't
// require a Next.js / @-alias test harness. The actual deep-merge semantics
// are covered by src/lib/cave-config.test.ts.
//
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

// 1. The route must still load the existing config so we can carry over
//    user-set fields when writing.
assert.match(
  source,
  /const\s+existing\s*=\s*await\s+loadConfig\(\)/,
  "setup route should call loadConfig() to read the existing cave-config.json before writing",
);

// 2. The route MUST preserve addons from the existing config.
assert.match(
  source,
  /addons:\s*existing\.addons/,
  "setup route should preserve existing.addons when writing the next config (otherwise creating a familiar wipes the user's add-on settings)",
);

// 3. Same for roles.
assert.match(
  source,
  /roles:\s*existing\.roles/,
  "setup route should preserve existing.roles when writing the next config",
);

// 4. Same for marketplace.installed.
assert.match(
  source,
  /marketplace:\s*existing\.marketplace/,
  "setup route should preserve existing.marketplace (installed plugins) when writing the next config",
);

// 5. Defensive guard: ensure nextConfig is NOT a literal that only enumerates
//    {version, defaults, familiars} — i.e. block the regression. We assert
//    the pre-fix shape doesn't appear verbatim.
assert.doesNotMatch(
  source,
  /const\s+nextConfig\s*=\s*\{\s*\n\s*version:\s*existing\.version\s*\|\|\s*1,\s*\n\s*defaults:\s*\{\s*harness,\s*model\s*\},\s*\n\s*familiars:[\s\S]{0,400}?\}\s*\n\s*\};/,
  "setup route's nextConfig must not be a {version, defaults, familiars}-only literal — that wipes addons/roles/marketplace on every familiar create",
);

console.log("onboarding-setup-preserve-config.test.ts: ok");
