// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(route, /rejectNonLocalRequest\(req\)/, "remote skill use is local-origin gated");
assert.match(route, /readJsonBody<UseBody>\(req, MAX_BODY_BYTES\)/, "invalid JSON is handled before use work");
assert.match(route, /matchDirectoryEntry\(id, directory\.entries, source\)/, "use resolves the request against the directory entry");
assert.match(route, /execFileAsync\("npx", args/, "skills use uses execFile argv arrays, not shell command strings");
assert.match(route, /\["--yes", "skills", "use", target, "--skill", skill\]/, "skills use asks the CLI for a prompt without launching an agent");
assert.match(route, /localSkillDirective\(entry\)/, "local-only skills fall back to the existing Cave skill directive");
assert.match(route, /SAFE_USE_TARGET_RE/, "use target is constrained before invoking npx");
assert.match(route, /SAFE_SKILL_NAME_RE/, "skill name is constrained before invoking npx");
assert.match(route, /stdout\.trim\(\)/, "skills use returns the CLI-generated prompt body");

console.log("skills/directory/use route.test.ts OK");
