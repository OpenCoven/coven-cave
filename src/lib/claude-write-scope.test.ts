// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, lstat, readFile, symlink, access } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { buildClaudeWriteScope, prepareClaudeWriteScopeFile, countClaudeWriteDenials, claudeWriteScopeRefusal } from "./claude-write-scope.ts";

const root = await mkdtemp(path.join(tmpdir(), "cave-write-scope-test-"));
for (const dir of ["primary", "read", "read/write", "primary/skills", "workspace"]) await mkdir(path.join(root, dir), { recursive: true });
await symlink(path.join(root, "read/write"), path.join(root, "write-alias"), process.platform === "win32" ? "junction" : "dir");
const primary = path.join(root, "primary");
const read = path.join(root, "read");
const write = path.join(root, "read/write");
const alias = path.join(root, "write-alias");
const input = {
  primaryRoot: primary, primaryAccess: "write", grantedProjectRoots: [read, write, alias],
  projectRootAccess: { [read]: "read", [write]: "read", [alias]: "write" },
  familiarWorkspace: path.join(root, "workspace"), protectedRoots: [path.join(primary, "skills")],
};
const scope = buildClaudeWriteScope(input);
assert.equal(scope.version, 1);
assert.equal(scope.writableRoots.length, 3, "primary, writable alias and own workspace are distinct canonical grants");
assert.ok(scope.writableRoots.some(p => p.replaceAll("\\", "/").endsWith("/read/write")));
assert.ok(!scope.writableRoots.includes(scope.readOnlyRoots[0]));
assert.equal(scope.readOnlyRoots.length, 1, "a read alias must not override explicit write authority for the same directory");
assert.ok(scope.protectedRoots[0].replaceAll("\\", "/").endsWith("/primary/skills"), "nested protected roots are preserved");
assert.throws(() => buildClaudeWriteScope({ ...input, primaryAccess: "read" }), /read-only/i);
assert.throws(() => buildClaudeWriteScope({ ...input, primaryAccess: undefined }), /write access/i);
const file = prepareClaudeWriteScopeFile(scope);
await assert.rejects(access(file.path), "scope files are not created until the admitted stream starts");
await file.create();
assert.deepEqual(JSON.parse(await readFile(file.path, "utf8")), scope);
if (process.platform !== "win32") assert.equal((await lstat(file.path)).mode & 0o777, 0o600);
await file.dispose();
await assert.rejects(access(file.path));
assert.equal(countClaudeWriteDenials({ permission_denials: [{ tool_name: "Write", tool_input: { file_path: "PRIVATE_PATH" } }] }), 1);
assert.equal(countClaudeWriteDenials({ permission_denials: [{ tool_name: "Bash" }, { tool_name: "Edit" }] }), 2);
assert.equal(countClaudeWriteDenials({ permission_denials: "malformed" }), 0);
assert.equal(countClaudeWriteDenials(null), 0);
assert.equal(claudeWriteScopeRefusal("writeScope has filesystem-object aliases outside its writable roots PRIVATE_PATH").code, "write_scope_aliases_unsupported");
assert.doesNotMatch(JSON.stringify(claudeWriteScopeRefusal("writeScope has filesystem-object aliases PRIVATE_PATH")), /PRIVATE_PATH/);
assert.equal(claudeWriteScopeRefusal("Claude scoped-write profile is unsupported; qualified version is 2.1.316").code, "write_scope_profile_unqualified");
assert.equal(claudeWriteScopeRefusal("unrelated provider error"), null);
console.log("claude-write-scope.test.ts: ok");
