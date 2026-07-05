// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(route, /rejectNonLocalRequest\(req\)/, "remote skill installation is local-origin gated");
assert.match(route, /readJsonBody<InstallBody>\(req, MAX_BODY_BYTES\)/, "invalid JSON is handled before install work");
assert.match(route, /matchDirectoryEntry\(id, directory\.entries, source\)/, "install resolves the request against the directory entry");
assert.match(route, /entry\.installed \|\| entry\.local\?\.installed/, "already-installed skills short-circuit without running npx");
assert.match(route, /execFileAsync\("npx", args/, "installer uses execFile argv arrays, not shell command strings");
assert.match(route, /\["--yes", "skills", "add", target, "--skill", skill, "-g", "-y"\]/, "installer is noninteractive and global");
assert.match(route, /DEFAULT_INSTALL_AGENTS = \["claude-code", "codex"\]/, "installer targets Claude Code and Codex by default");
assert.match(route, /SAFE_INSTALL_TARGET_RE/, "install target is constrained before invoking npx");
assert.match(route, /SAFE_SKILL_NAME_RE/, "skill name is constrained before invoking npx");

console.log("skills/directory/install route.test.ts OK");
