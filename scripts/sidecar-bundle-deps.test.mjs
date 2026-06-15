/**
 * Security test: sidecar-bundle.sh must use locked pnpm dependencies (not npm)
 * and must dereference symlinks when copying node_modules to prevent symlink
 * attacks in the bundled artifact.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("./sidecar-bundle.sh", import.meta.url), "utf8");

// Must use locked pnpm install (frozen lockfile prevents supply chain attacks)
assert.match(src, /pnpm install --prod --frozen-lockfile/, "sidecar must install from locked pnpm lockfile");

// Must dereference symlinks when copying node_modules (-L flag)
assert.match(src, /cp -aL.*node_modules/, "node_modules copy must dereference symlinks (-aL) to prevent symlink attacks");

// Must NOT use npm install (unlocked, not reproducible)
assert.doesNotMatch(src, /(?<!p)npm install(?! --lockfile-version)/, "sidecar must not use unlocked npm install");

// PNPM_STAGE must be used as the source for the final node_modules
assert.match(src, /PNPM_STAGE.*node_modules/, "final node_modules must come from PNPM_STAGE (locked install)");

// Security: must not blindly copy symlinks from STANDALONE into bundle
assert.match(src, /cp -aL/, "all node_modules copies must dereference symlinks");

console.log("sidecar-bundle-deps.test: ok");
