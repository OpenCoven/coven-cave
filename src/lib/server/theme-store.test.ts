// @ts-nocheck
// Guards the fix for the theme-write crash: a fixed `.tmp` filename let
// concurrent PUT /api/theme requests race (first rename consumed the temp,
// second hit ENOENT and crashed the dev server). The write must use a unique
// temp name and never let a failure escape the route handler.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const store = await readFile(new URL("./theme-store.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../../app/api/theme/route.ts", import.meta.url), "utf8");

assert.doesNotMatch(
  store,
  /const tmp = THEME_PATH \+ "\.tmp"/,
  "theme-store must not use a single fixed temp filename (concurrent writes race on it)",
);

assert.match(
  store,
  /const tmp = `\$\{THEME_PATH\}\.\$\{process\.pid\}\.\$\{randomBytes\(/,
  "theme-store should write to a per-process, randomized temp file so parallel saves don't collide",
);

assert.match(
  store,
  /catch \(err\) \{[\s\S]*rm\(tmp, \{ force: true \}\)[\s\S]*throw err/,
  "a failed write should clean up its temp file and rethrow (no orphaned temp, no swallowed error)",
);

assert.match(
  route,
  /try \{[\s\S]*await saveTheme\(body\)[\s\S]*\} catch[\s\S]*status: 500/,
  "PUT /api/theme must wrap saveTheme so a write failure returns 500 instead of crashing the server",
);

// The path is env-overridable so tests / E2E / throwaway servers never write a
// real user's ~/.coven/cave-theme.json (which the iOS app polls).
assert.match(
  store,
  /function themePath\(\): string/,
  "the snapshot path is resolved through a themePath() function (call-time, not a module const)",
);
assert.match(
  store,
  /process\.env\.COVEN_THEME_PATH \?\? path\.join\(homedir\(\), "\.coven", "cave-theme\.json"\)/,
  "themePath honours COVEN_THEME_PATH, falling back to ~/.coven/cave-theme.json",
);

// The E2E web server points the theme store at a throwaway file.
const e2e = await readFile(new URL("../../../playwright.config.ts", import.meta.url), "utf8");
assert.match(
  e2e,
  /COVEN_THEME_PATH: join\(tmpdir\(\)/,
  "the Playwright web server redirects theme writes to a temp file",
);

console.log("theme-store.test.ts: ok");
