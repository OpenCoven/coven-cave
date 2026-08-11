// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(route, /rejectNonLocalRequest\(req\)/, "remote skill use is local-origin gated");
assert.match(route, /readJsonBody<UseBody>\(req, MAX_BODY_BYTES\)/, "invalid JSON is handled before use work");
assert.match(route, /matchDirectoryEntry\(id, candidates, localOnly \? "" : source\)/, "use resolves the request against the narrowed directory entries");
assert.match(route, /execFileAsync\("npx", args/, "skills use uses execFile argv arrays, not shell command strings");
assert.match(route, /\["--yes", "skills", "use", target, "--skill", skill\]/, "skills use asks the CLI for a prompt without launching an agent");
assert.match(route, /localSkillDirective\(entry\)/, "local-only skills fall back to the existing Cave skill directive");
assert.match(route, /SAFE_USE_TARGET_RE/, "use target is constrained before invoking npx");
assert.match(route, /SAFE_SKILL_NAME_RE/, "skill name is constrained before invoking npx");
assert.match(route, /stdout\.trim\(\)/, "skills use returns the CLI-generated prompt body");
assert.match(route, /parsed\.body\.scope === "local"/, "Marketplace can request a local-only prompt");
assert.match(route, /listLocalSkillDirectoryEntries\(\)/, "local prompt resolution performs no registry listing");
assert.match(route, /directory\.entries\.filter\(\(candidate\) => candidate\.local\?\.path === localPath\)/, "duplicate local ids are narrowed by an allow-listed scanned path");
assert.match(route, /matchDirectoryEntry\(id, candidates, localOnly \? "" : source\)/, "the requested id must still match the path-disambiguated local entry");
assert.match(route, /if \(localOnly\)[\s\S]*localSkillDirective\(entry\)/, "local prompt resolution never shells out to the Skills CLI");

console.log("skills/directory/use route.test.ts OK");
