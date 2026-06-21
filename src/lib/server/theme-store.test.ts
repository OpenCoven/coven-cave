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

console.log("theme-store.test.ts: ok");
