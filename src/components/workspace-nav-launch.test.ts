// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

// On launch, the home screen opens the left nav (overriding a persisted
// collapsed layout), desktop-only, via the shell handle.
assert.match(
  source,
  /requestAnimationFrame\(\s*\(\) => \{[\s\S]*?matchMedia\("\(min-width: 1024px\)"\)[\s\S]*?modeRef\.current === "home"[\s\S]*?shellRef\.current\?\.openNav\(\)/,
  "workspace should open the left nav on launch when the home screen is the landing surface (desktop only)",
);

console.log("workspace-nav-launch source assertions passed");
