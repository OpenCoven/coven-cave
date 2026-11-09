// @ts-nocheck
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { mkdtemp, mkdir, lstat, readFile, readdir, rename, rm, symlink, access, utimes, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { buildClaudeWriteScope, ClaudeAuthorityRootError, loadClaudeFamiliarMcpServers, prepareClaudeWriteScopeFile, retireAbandonedClaudeAuthorityFiles, countClaudeWriteDenials, claudeWriteScopeRefusal } from "./claude-write-scope.ts";

const root = await mkdtemp(path.join(tmpdir(), "cave-write-scope-test-"));
const caveHomeForTest = path.join(root, "cave");
process.env.COVEN_CAVE_HOME = caveHomeForTest;
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
assert.equal(scope.version, 2);
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
const authorityRoot = await realpath(path.join(caveHomeForTest, "claude-authority"));
assert.equal(path.dirname(path.dirname(file.path)), authorityRoot, "authority files live under Cave's home, not temp");
assert.deepEqual(JSON.parse(await readFile(file.path, "utf8")), {
  ...scope, protectedRoots: [...scope.protectedRoots, path.dirname(file.path)].sort(),
}, "a launch denies its own authority directory to its own sandbox");
if (process.platform !== "win32") assert.equal((await lstat(file.path)).mode & 0o777, 0o600);
if (process.platform !== "win32") assert.equal((await lstat(path.dirname(file.path))).mode & 0o777, 0o700);
await file.dispose();
await assert.rejects(access(file.path));
await file.dispose();
assert.equal(countClaudeWriteDenials({ permission_denials: [{ tool_name: "Write", tool_input: { file_path: "PRIVATE_PATH" } }] }), 1);
assert.equal(countClaudeWriteDenials({ permission_denials: [{ tool_name: "Bash" }, { tool_name: "Edit" }] }), 2);
assert.equal(countClaudeWriteDenials({ permission_denials: "malformed" }), 0);
assert.equal(countClaudeWriteDenials(null), 0);
assert.equal(claudeWriteScopeRefusal("writeScope has filesystem-object aliases outside its writable roots PRIVATE_PATH").code, "write_scope_aliases_unsupported");
assert.doesNotMatch(JSON.stringify(claudeWriteScopeRefusal("writeScope has filesystem-object aliases PRIVATE_PATH")), /PRIVATE_PATH/);
assert.equal(claudeWriteScopeRefusal("Claude scoped-write profile is unsupported; qualified versions start at 2.1.318").code, "write_scope_profile_unqualified");
assert.equal(claudeWriteScopeRefusal("writeScope root contains unsupported native rule syntax").code, "write_scope_path_unsupported");
assert.equal(claudeWriteScopeRefusal("unrelated provider error"), null);

// MCP servers run outside the shell sandbox, so only owner config may name them.
const configDir = path.join(root, "config");
const workspace = path.join(root, "workspace");
await mkdir(configDir);
await writeFile(path.join(configDir, ".claude.json"), JSON.stringify({
  mcpServers: { user: { command: "u" }, shadowed: { command: "user" }, "bad name*": { command: "x" } },
  projects: {
    [await realpath(workspace)]: { mcpServers: { perWorkspace: { command: "p" }, localWins: { command: "local" } } },
    [primary]: { mcpServers: { otherProject: { command: "o" } } },
  },
}));
await writeFile(path.join(workspace, ".mcp.json"), JSON.stringify({ mcpServers: { shadowed: { command: "workspace" }, localWins: { command: "workspace" } } }));
await writeFile(path.join(primary, ".mcp.json"), JSON.stringify({ mcpServers: { fromRepo: { command: "repo" } } }));
const servers = await loadClaudeFamiliarMcpServers({ familiarWorkspace: workspace, configDir });
assert.deepEqual(Object.keys(servers).sort(), ["localWins", "perWorkspace", "shadowed", "user"], "a repository's own .mcp.json and unsafe rule names are excluded");
assert.equal(servers.shadowed.command, "workspace", "the workspace file beats user scope");
assert.equal(servers.localWins.command, "local", "a per-workspace entry beats the workspace file, as in Claude");
assert.deepEqual(await loadClaudeFamiliarMcpServers({ configDir: path.join(root, "missing") }), {});
await writeFile(path.join(configDir, ".claude.json"), "{not json");
assert.deepEqual(Object.keys(await loadClaudeFamiliarMcpServers({ familiarWorkspace: workspace, configDir })).sort(), ["localWins", "shadowed"], "unreadable config adds no servers");

// A workspace that sits inside a project is that repository's content.
assert.deepEqual(await loadClaudeFamiliarMcpServers({ familiarWorkspace: workspace, configDir, projectRoots: [workspace] }), {});
assert.deepEqual(await loadClaudeFamiliarMcpServers({ familiarWorkspace: workspace, configDir, projectRoots: [root] }), {});
assert.deepEqual(Object.keys(await loadClaudeFamiliarMcpServers({ familiarWorkspace: workspace, configDir, projectRoots: [primary] })).sort(), ["localWins", "shadowed"], "another project doesn't make it one");

// The owner's disable lists for this workspace hold, since Claude only checks the launch's own project.
await writeFile(path.join(configDir, ".claude.json"), JSON.stringify({
  mcpServers: { off: { command: "u" }, on: { command: "u" } },
  projects: { [await realpath(workspace)]: { mcpServers: { localOff: { command: "p" } }, disabledMcpServers: ["off", "localOff"], disabledMcpjsonServers: ["shadowed"] } },
}));
assert.deepEqual(Object.keys(await loadClaudeFamiliarMcpServers({ familiarWorkspace: workspace, configDir })).sort(), ["localWins", "on"]);

// Only well-formed entries reach Claude's config.
for (const mcpServers of ["abc", ["x"], null, 7]) {
  await writeFile(path.join(configDir, ".claude.json"), JSON.stringify({ mcpServers }));
  await rm(path.join(workspace, ".mcp.json"));
  assert.deepEqual(await loadClaudeFamiliarMcpServers({ familiarWorkspace: workspace, configDir }), {}, `mcpServers: ${JSON.stringify(mcpServers)}`);
  await writeFile(path.join(workspace, ".mcp.json"), JSON.stringify({ mcpServers: {} }));
}
await writeFile(path.join(configDir, ".claude.json"), JSON.stringify({ mcpServers: {
  nothing: null, text: "x", noCommand: { type: "stdio" }, badArgs: { command: "c", args: "a" }, badEnv: { command: "c", env: { A: 1 } }, badHelper: { url: "http://x", headersHelper: 1 },
  stdio: { command: "c", args: ["a"], env: { A: "1" } }, remote: { type: "http", url: "http://x" },
} }));
assert.deepEqual(Object.keys(await loadClaudeFamiliarMcpServers({ configDir })).sort(), ["remote", "stdio"]);

// An empty CLAUDE_CONFIG_DIR must not read a config from the server's own directory.
await writeFile(path.join(root, ".claude.json"), JSON.stringify({ mcpServers: { planted: { command: "x" } } }));
const previous = { cwd: process.cwd(), dir: process.env.CLAUDE_CONFIG_DIR, home: process.env.HOME };
process.chdir(root);
process.env.CLAUDE_CONFIG_DIR = "";
process.env.HOME = path.join(root, "missing");
assert.deepEqual(await loadClaudeFamiliarMcpServers({}), {});
process.chdir(previous.cwd);
process.env.HOME = previous.home;
if (previous.dir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
else process.env.CLAUDE_CONFIG_DIR = previous.dir;
await rm(path.join(root, ".claude.json"));

// Local MCP processes run outside the sandbox, so nothing a familiar can rewrite may decide what they execute.
const neutralHome = await realpath(path.join(caveHomeForTest));
const confinedFile = prepareClaudeWriteScopeFile(scope, {
  stdio: { command: "npx", args: ["-y", "@acme/server"], env: { TOKEN: "t" } },
  remote: { type: "http", url: "https://example.com/mcp" },
  helped: { type: "http", url: "https://example.com/mcp", headersHelper: "/opt/bin/token.sh" },
});
assert.deepEqual(confinedFile.excludedMcpServers, []);
await confinedFile.create();
const confinedScope = JSON.parse(await readFile(confinedFile.path, "utf8"));
assert.deepEqual(confinedScope.mcpServerNames, ["helped", "remote", "stdio"]);
const confinedServers = JSON.parse(await readFile(confinedScope.mcpConfigFile, "utf8")).mcpServers;
const neutral = path.join(neutralHome, "claude-authority");
assert.deepEqual(confinedServers.stdio, { command: "/bin/sh", args: ["-c", 'cd "$1" && shift && exec "$@"', "sh", neutral, "npx", "-y", "@acme/server"], env: { TOKEN: "t" } });
assert.deepEqual(confinedServers.remote, { type: "http", url: "https://example.com/mcp" }, "a remote server has no local process to move");
assert.equal(confinedServers.helped.headersHelper, `cd '${neutral}' && /opt/bin/token.sh`, "a headers helper is a local process too");
await confinedFile.dispose();

if (process.platform !== "win32") {
  const inWorkspace = path.join(await realpath(workspace), "tools", "server.mjs");
  const inPrimary = path.join(await realpath(primary), "node_modules", "x");
  process.env.CAVE_TEST_WORKSPACE = await realpath(workspace);
  const excludedFile = prepareClaudeWriteScopeFile(scope, {
    command: { command: inWorkspace },
    argument: { command: "node", args: [inWorkspace] },
    directoryArgument: { command: "uv", args: ["--directory", await realpath(primary), "run", "x"] },
    flagValue: { command: "node", args: [`--config=${inPrimary}`] },
    environment: { command: "node", env: { NODE_PATH: `/opt/lib:${inPrimary}` } },
    reference: { command: "node", args: ["${CAVE_TEST_WORKSPACE}/tools/server.mjs"] },
    referenceFallback: { command: "node", args: [`\${CAVE_TEST_MISSING:-${inWorkspace}}`] },
    throughAlias: { command: "node", args: [path.join(alias, "server.mjs")] },
    helper: { type: "http", url: "https://example.com/mcp", headersHelper: `${inWorkspace} --token` },
    outside: { command: "/usr/bin/env", args: ["node", path.join(root, "read", "tool.mjs")] },
    siblingPrefix: { command: "node", args: [`${await realpath(primary)}-sibling/tool.mjs`] },
  });
  delete process.env.CAVE_TEST_WORKSPACE;
  assert.deepEqual(excludedFile.excludedMcpServers, ["argument", "command", "directoryArgument", "environment", "flagValue", "helper", "reference", "referenceFallback", "throughAlias"].sort());
  await excludedFile.create();
  const excludedScope = JSON.parse(await readFile(excludedFile.path, "utf8"));
  assert.deepEqual(excludedScope.mcpServerNames, ["outside", "siblingPrefix"], "a read-only grant and a matching name prefix are not writable reach");
  await excludedFile.dispose();
  const allExcluded = prepareClaudeWriteScopeFile(scope, { only: { command: inWorkspace } });
  await allExcluded.create();
  const allExcludedScope = JSON.parse(await readFile(allExcluded.path, "utf8"));
  assert.equal(allExcludedScope.mcpConfigFile, undefined, "no servers left means no MCP config on disk");
  assert.deepEqual(await readdir(path.dirname(allExcluded.path)), ["scope.json"]);
  await allExcluded.dispose();
}
await rm(path.join(workspace, ".mcp.json"), { force: true });

const mcpFile = prepareClaudeWriteScopeFile(scope, { sanity: { command: "s", env: { TOKEN: "SECRET" } } });
await mcpFile.create();
const written = JSON.parse(await readFile(mcpFile.path, "utf8"));
assert.deepEqual(written.mcpServerNames, ["sanity"]);
assert.doesNotMatch(JSON.stringify(written), /SECRET/, "credentials stay out of the scope file");
assert.deepEqual(JSON.parse(await readFile(written.mcpConfigFile, "utf8")).mcpServers.sanity.env, { TOKEN: "SECRET" });
if (process.platform !== "win32") assert.equal((await lstat(written.mcpConfigFile)).mode & 0o777, 0o600);
await mcpFile.dispose();
await assert.rejects(access(written.mcpConfigFile));
await assert.rejects(access(path.dirname(written.mcpConfigFile)));

// A writable grant over the root would expose every turn's files, not just this one's.
// The builder canonicalizes these, so a path alias can't dodge the check.
for (const granted of [root, caveHomeForTest, path.join(caveHomeForTest, "claude-authority")]) {
  assert.throws(
    () => prepareClaudeWriteScopeFile(buildClaudeWriteScope({ ...input, grantedProjectRoots: [granted], projectRootAccess: { [granted]: "write" } })),
    ClaudeAuthorityRootError,
    `writable ${granted} covers the authority root`,
  );
}
// A grant on another turn's directory is the same reach by a narrower door.
assert.throws(
  () => prepareClaudeWriteScopeFile({ ...scope, writableRoots: [...scope.writableRoots, path.join(authorityRoot, `1-${randomUUID()}`)] }),
  /overlaps Cave's private state folder/,
  "a grant inside the authority root is refused too",
);
// A blocked home gets a message about the home, not about project access.
await writeFile(path.join(root, "not-a-folder"), "");
process.env.COVEN_CAVE_HOME = path.join(root, "not-a-folder");
assert.throws(() => prepareClaudeWriteScopeFile(scope), /couldn't open its private state folder/);
process.env.COVEN_CAVE_HOME = caveHomeForTest;
assert.doesNotThrow(() => prepareClaudeWriteScopeFile({ ...scope, writableRoots: [...scope.writableRoots, `${authorityRoot}-sibling`] }), "a matching name prefix is not containment");
assert.deepEqual(await readdir(authorityRoot), [], "preparing allocates no per-turn files");

const credentials = { sanity: { command: "s", env: { TOKEN: "SECRET" } } };
const injected = (message) => Object.assign(new Error(`injected ${message}`), { code: "ENOSPC" });
const realFileSystem = { lstat: nodeFs.lstat, mkdir: nodeFs.mkdir, open: nodeFs.open, readdir: nodeFs.readdir, readFile: nodeFs.readFile, rm: nodeFs.rm, rmdir: nodeFs.rmdir, unlink: nodeFs.unlink };
const failingAt = (fileName, step) => ({
  ...realFileSystem,
  async open(target, ...rest) {
    if (path.basename(target) !== fileName) return realFileSystem.open(target, ...rest);
    if (step === "open") throw injected(step);
    const handle = await realFileSystem.open(target, ...rest);
    return {
      async writeFile(contents) {
        if (step !== "partial write") return handle.writeFile(contents);
        await handle.writeFile(contents.slice(0, 5));
        throw injected(step);
      },
      async stat() {
        if (step === "stat") throw injected(step);
        return handle.stat();
      },
      async close() {
        await handle.close();
        if (step === "close") throw injected(step);
      },
    };
  },
});

// Creation can fail at any step of either file without leaving credentials behind.
for (const fileName of ["mcp.json", "scope.json"]) {
  for (const step of ["open", "partial write", "stat", "close"]) {
    const failing = prepareClaudeWriteScopeFile(scope, credentials, { fileSystem: failingAt(fileName, step) });
    await assert.rejects(failing.create(), new RegExp(`injected ${step}`), `${fileName} ${step} failure surfaces`);
    assert.deepEqual(await readdir(authorityRoot), [], `${fileName} ${step} failure leaves nothing on disk`);
    await failing.dispose();
    await assert.rejects(failing.assertIntact(), `a failed ${fileName} ${step} creation can never launch`);
  }
}

// When that cleanup itself fails, dispose finishes the job.
let unlinkBlocked = true;
const flaky = prepareClaudeWriteScopeFile(scope, credentials, { fileSystem: {
  ...failingAt("scope.json", "partial write"),
  async unlink(target) {
    if (unlinkBlocked) throw Object.assign(new Error("injected busy"), { code: "EBUSY" });
    return realFileSystem.unlink(target);
  },
} });
await assert.rejects(flaky.create(), /injected partial write/, "the original failure survives a failed cleanup");
const flakyDirectory = path.dirname(flaky.path);
assert.deepEqual((await readdir(flakyDirectory)).sort(), ["mcp.json", "scope.json"]);
await assert.rejects(flaky.dispose(), /retained for inspection/, "a blocked removal is reported");
unlinkBlocked = false;
await flaky.dispose();
await assert.rejects(access(flakyDirectory), "dispose retires what the failed cleanup could not");

// A replaced scope file is kept for inspection, but it can't strand the credentials.
const replaced = prepareClaudeWriteScopeFile(scope, credentials);
await replaced.create();
const replacedDirectory = path.dirname(replaced.path);
await writeFile(`${replaced.path}.swap`, "{}");
await rename(`${replaced.path}.swap`, replaced.path);
await assert.rejects(replaced.dispose(), /retained for inspection/);
assert.deepEqual(await readdir(replacedDirectory), ["scope.json"], "credentials retire independently of the scope file");
await rm(replacedDirectory, { recursive: true });

// Every launch checks both files, because a retry reuses them.
const tampered = async (change) => {
  const target = prepareClaudeWriteScopeFile(scope, credentials);
  await assert.rejects(target.assertIntact(), "nothing can launch before creation");
  await target.create();
  await target.assertIntact();
  await change(target.path, path.join(path.dirname(target.path), "mcp.json"));
  await assert.rejects(target.assertIntact(), /changed after it was written|ENOENT/);
  await rm(path.dirname(target.path), { recursive: true });
};
const widen = (scopePath) => readFile(scopePath, "utf8").then(text => writeFile(scopePath, text.replace('"writableRoots":[', '"writableRoots":["/tampered",')));
await tampered(widen);
await tampered((_, mcpPath) => writeFile(mcpPath, JSON.stringify({ mcpServers: { sanity: { command: "evil" } } })));
await tampered(async (_, mcpPath) => {
  const contents = await readFile(mcpPath);
  await writeFile(`${mcpPath}.swap`, contents);
  await rename(`${mcpPath}.swap`, mcpPath);
});
await tampered((_, mcpPath) => rm(mcpPath));

// A killed server can't dispose, so the next turn retires only what a dead owner left.
const gone = spawnSync(process.execPath, ["-e", ""]).pid;
const abandoned = path.join(authorityRoot, `${gone}-${randomUUID()}`);
const liveTurn = path.join(authorityRoot, `${process.ppid}-${randomUUID()}`);
const unrelated = path.join(authorityRoot, "not-an-authority-directory");
for (const directory of [abandoned, liveTurn, unrelated]) {
  await mkdir(directory);
  await writeFile(path.join(directory, "mcp.json"), "SECRET");
}
// A restarted container gets the same PID back, so its predecessor's directory bears this process's own number.
const predecessor = path.join(authorityRoot, `${process.pid}-${randomUUID()}`);
await mkdir(predecessor);
await writeFile(path.join(predecessor, "mcp.json"), "SECRET");
const beforeThisProcess = new Date(Date.now() - process.uptime() * 1000 - 60_000);
await utimes(predecessor, beforeThisProcess, beforeThisProcess);
const sweeping = prepareClaudeWriteScopeFile(scope, credentials);
await sweeping.create();
await assert.rejects(access(abandoned), "credentials from a dead owner are retired");
await assert.rejects(access(predecessor), "credentials from a same-PID predecessor are retired");
await sweeping.assertIntact();
await access(path.join(liveTurn, "mcp.json"));
await access(path.join(unrelated, "mcp.json"));
await sweeping.assertIntact();

// Startup runs the same sweep without waiting for a turn, and spares this process's live turn.
const startupAbandoned = path.join(authorityRoot, `${gone}-${randomUUID()}`);
await mkdir(startupAbandoned);
await retireAbandonedClaudeAuthorityFiles();
await assert.rejects(access(startupAbandoned));
await sweeping.assertIntact();
await sweeping.dispose();
await rm(root, { recursive: true, force: true });
console.log("claude-write-scope.test.ts: ok");
