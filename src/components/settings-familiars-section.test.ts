// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Familiar management migrated to Chat → Familiar → Settings. Keep the
// retired Settings route out of both the shell and the section catalog.
const shell = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const sections = await readFile(new URL("./settings-sections.ts", import.meta.url), "utf8");

assert.doesNotMatch(shell, /FamiliarsSection|section === "familiars"/, "Settings no longer renders the retired Familiars section");
assert.doesNotMatch(sections, /id: "familiars"|section: "familiars"/, "Settings no longer catalogs the retired Familiars section");
assert.doesNotMatch(shell, /FamiliarStudioProvider/, "Settings no longer mounts the retired Familiar Studio provider");

console.log("settings-familiars-section.test.ts: ok");
