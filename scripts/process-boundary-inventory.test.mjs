import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { discoverBoundaries, compareInventory, auditContracts, packInventory, unpackInventory, validateRustParserReply } from "./process-boundary-inventory.mjs";

function fixture(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), "cave-boundary-inventory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), source);
  }
  return root;
}

test("renamed process imports and multi-hop wrappers retain the primitive call", (t) => {
  const root = fixture(t, {
    "src/wrapper.ts": 'import { spawn as launch } from "node:child_process"; const first = launch; const second = first; export const wrapper = () => second("node", []);',
    "src/client.ts": 'import { wrapper as run } from "./wrapper"; run();',
  });
  const rows = discoverBoundaries(root);
  assert.ok(rows.some((r) => r.file === "src/wrapper.ts" && r.kind === "call" && r.capability.includes("child_process.spawn")));
  assert.equal(compareInventory(rows, []).missing.length, rows.length);
});

test("relative wrapper consumers are source-bound unresolved obligations", (t) => {
  const root = fixture(t, {
    "src/wrapper.ts": 'import {spawn} from "node:child_process"; export const run = (args) => spawn("node", args);',
    "src/client.ts": 'import {run} from "./wrapper"; run(["first"]);',
  });
  const before = discoverBoundaries(root);
  assert.ok(before.some((r) => r.file === "src/client.ts" && r.kind === "source-review"));
  writeFileSync(path.join(root, "src/client.ts"), 'import {run} from "./wrapper"; run(["changed"]); run(["second"]);');
  assert.ok(compareInventory(discoverBoundaries(root), before).changed.length > 0);
});

test("local dynamic imports, require and import-equals retain unresolved delegation", (t) => {
  for (const [name, initial] of Object.entries({
    "dynamic.ts": 'const {run} = await import("./wrapper");',
    "common.cjs": 'const {run} = require("./wrapper");',
    "equals.cts": 'import wrapper = require("./wrapper"); const run = wrapper.run;',
  })) {
    const file = `src/${name}`;
    const root = fixture(t, { [file]: `${initial} run(["first"]);` });
    const before = discoverBoundaries(root);
    assert.ok(before.some((r) => r.file === file && r.kind === "source-review"), name);
    writeFileSync(path.join(root, file), `${initial} run(["changed"]); run(["second"]);`);
    assert.ok(compareInventory(discoverBoundaries(root), before).changed.length > 0, name);
  }
});

test("capabilities in JS containers cannot silently lose their obligations", (t) => {
  const root = fixture(t, {
    "src/object.ts": 'import {spawn} from "child_process"; const ops = {run: spawn}; ops.run("node");',
    "src/array.ts": 'import {spawn} from "child_process"; const [run] = [spawn]; run("node");',
  });
  const rows = discoverBoundaries(root);
  for (const file of ["src/object.ts", "src/array.ts"]) assert.ok(rows.some((r) => r.file === file && r.kind === "source-review" && r.capability.includes("storage")), file);
});

test("executable HTML and native launch configuration require review", (t) => {
  const root = fixture(t, {
    "src-tauri/startup.html": '<script>new WebSocket("ws://localhost:3333")</script>',
    "src-tauri/action.wxs": '<CustomAction ExeCommand="tool"/>',
    "scripts/job.plist": '<key>ProgramArguments</key><array><string>tool</string></array>',
  });
  const rows = discoverBoundaries(root);
  assert.equal(rows.filter((r) => r.kind === "source-review").length, 3);
});

test("the standalone server source entrypoint stays in the denominator", (t) => {
  const root = fixture(t, { "server.ts": 'import {createServer} from "node:http"; createServer().listen(3000);' });
  assert.ok(discoverBoundaries(root).some((r) => r.file === "server.ts" && r.kind === "call"));
});

test("namespace, require, destructuring and computed access cannot disappear", (t) => {
  const root = fixture(t, {
    "scripts/launch.cjs": 'const cp = require("child_process"); const { execFile: run } = cp; run("node", []); cp[method]("node", []);',
    "src/socket.ts": 'import * as net from "node:net"; net["createServer"](); const connect = net.connect.bind(net); connect("socket");',
  });
  const rows = discoverBoundaries(root);
  for (const capability of ["child_process.execFile", "net.createServer", "net.connect"]) {
    assert.ok(rows.some((r) => r.kind === "call" && r.capability.includes(capability)), capability);
  }
  assert.ok(rows.some((r) => r.capability.includes("child_process.*")), "computed unknown method requires review");
});

test("dynamic imports, capability escapes and reassignment require review", (t) => {
  const root = fixture(t, {
    "src/dynamic.ts": 'const cp = await import("node:child_process"); let execute; execute = cp.spawn; register(execute); execute("node", []); const other = require(moduleName);',
  });
  const rows = discoverBoundaries(root);
  assert.ok(rows.some((r) => r.kind === "call" && r.capability.includes("child_process.spawn")));
  assert.ok(rows.some((r) => r.kind === "escape"), "passing a capability needs an explicit wrapper/escape review");
  assert.ok(rows.some((r) => r.kind === "dynamic-load"));
});

test("import-equals and aliased require/createRequire retain load and spawn", (t) => {
  const root = fixture(t, {
    "src/equals.cts": 'import cp = require("node:child_process"); cp.spawn("node", []);',
    "scripts/alias.cjs": 'const load = require; const cp = load("child_process"); cp.spawn("node", []);',
    "scripts/esm.mjs": 'import { createRequire as makeLoader } from "node:module"; const load = makeLoader(import.meta.url); const cp = load("child_process"); cp.spawn("node", []);',
  });
  const rows = discoverBoundaries(root);
  for (const file of ["src/equals.cts", "scripts/alias.cjs", "scripts/esm.mjs"]) {
    assert.ok(rows.some((r) => r.file === file && r.kind === "call" && r.capability.includes("child_process.spawn")), file);
  }
});

test("destructuring assignment and exported capability references are obligations", (t) => {
  const root = fixture(t, {
    "src/exports.ts": 'import cp from "child_process"; let run; ({ spawn: run } = cp); export { run }; run("node", []);',
  });
  const rows = discoverBoundaries(root);
  assert.ok(rows.some((r) => r.kind === "call" && r.capability.includes("child_process.spawn")));
  assert.ok(rows.some((r) => r.kind === "escape"));
});

test("promisified launchers, aliased eval and listener handles remain visible", (t) => {
  const root = fixture(t, {
    "src/wrapped.ts": 'import { execFile } from "node:child_process"; import { promisify as wrap } from "node:util"; const run = wrap(execFile); run("node", []); const evaluate = eval; evaluate(code);',
    "src/listen.ts": 'import { createServer } from "node:net"; const server = createServer(); const start = server.listen.bind(server); start("/tmp/fixture.sock");',
  });
  const rows = discoverBoundaries(root);
  for (const capability of ["child_process.execFile", "ambient.eval", "net.createServer().listen"]) {
    assert.ok(rows.some((r) => r.kind === "call" && r.capability.includes(capability)), capability);
  }
});

test("aliased builtin loaders and destructured socket constructors are visible", (t) => {
  const root = fixture(t, {
    "src/builtin.ts": 'const load = process.getBuiltinModule; const cp = load("child_process"); cp.spawn("node", []);',
    "src/construct.ts": 'import { Socket as Channel } from "node:net"; const channel = new Channel(); channel.connect("fixture.sock");',
  });
  const rows = discoverBoundaries(root);
  assert.ok(rows.some((r) => r.kind === "call" && r.capability.includes("child_process.spawn")));
  assert.ok(rows.some((r) => r.kind === "call" && r.capability.includes("net.Socket().connect")));
});

test("generated-directory names cannot hide source under a different location", (t) => {
  const root = fixture(t, {
    "src/target/escape.ts": 'import { spawn } from "child_process"; spawn("node");',
    "scripts/target/run.sh": 'exec node\n',
  });
  const rows = discoverBoundaries(root);
  assert.ok(rows.some((r) => r.file === "src/target/escape.ts" && r.kind === "call"));
  assert.ok(rows.some((r) => r.file === "scripts/target/run.sh"));
});

test("foreign, extensionless and unknown executable sources stay in denominator", (t) => {
  const root = fixture(t, {
    "src-tauri/src/main.rs": 'use std::process::Command as Launch; fn run() { Launch::new("node").spawn(); }',
    "scripts/run.py": 'import subprocess as child\nchild.run(["node"])\n',
    "scripts/run.sh": 'exec "$tool" "$@"\n',
    "scripts/custom": '#!/bin/sh\nexec "$tool"\n',
    "scripts/custom.zig": 'extern fn spawn() void;\n',
  });
  const rows = discoverBoundaries(root);
  for (const file of ["src-tauri/src/main.rs", "scripts/run.sh", "scripts/custom", "scripts/custom.zig"]) {
    assert.ok(rows.some((r) => r.file === file && r.kind === "source-review"), file);
  }
});

test("Python AST discovery follows aliases and records indirect/dynamic operations", (t) => {
  const root = fixture(t, {
    "scripts/python.py": 'import subprocess as child\nfrom socket import socket as Channel\nrun = child.run\nrun(["node"])\ns = Channel()\ns.bind("fixture.sock")\ngetattr(child, operation)(args)\nraise RuntimeError("source must never execute")\n',
    "scripts/broken.py": 'def broken(:\n',
  });
  const rows = discoverBoundaries(root);
  for (const capability of ["subprocess.run", "socket.socket", "socket.socket().bind"]) {
    assert.ok(rows.some((r) => r.kind === "call" && r.capability.includes(capability)), capability);
  }
  assert.ok(rows.some((r) => r.kind === "source-review" && r.file === "scripts/broken.py"));
  assert.ok(rows.some((r) => r.kind === "dynamic-load" && r.file === "scripts/python.py"));
});

test("Python container storage and returned capabilities remain obligations", (t) => {
  const root = fixture(t, {
    "scripts/storage.py": 'import subprocess as child\nops = {"run": child.run}\nrun, = (child.run,)\ndef expose():\n return child.run\n',
  });
  const rows = discoverBoundaries(root);
  assert.ok(rows.some((r) => r.kind === "source-review" && r.capability.includes("storage")));
  assert.ok(rows.some((r) => r.kind === "escape" && r.capability.includes("subprocess.run")));
});

test("Rust AST discovery retains renamed commands, native methods and all cfg paths", (t) => {
  const root = fixture(t, {
    "src-tauri/native.rs": 'use std::process::Command as Launch; fn run() { Launch::new("tool").spawn(); } #[cfg(windows)] fn win() { CreateNamedPipeW(name, flags); }',
  });
  const rows = discoverBoundaries(root);
  for (const target of ["std::process::Command::new", "rust-method:spawn", "CreateNamedPipeW"]) {
    assert.ok(rows.some((r) => r.kind === "call" && r.capability.includes(target)), target);
  }
  assert.ok(rows.some((r) => r.kind === "source-review"), "imports and platform attributes still need proof");
});

test("Rust parser replies bind current helper inputs and reject unknown source units", () => {
  const identity = { parserSource: "current-source", parserManifest: "current-manifest", parserLock: "current-lock" };
  const inputs = [{ file: "src-tauri/a.rs", sourceHash: "source-hash" }];
  const row = { file: inputs[0].file, line: 1, column: 1, kind: "call", capability: "rust:Command::new" };
  const reply = { schemaVersion: 1, ...identity, rows: [row] };
  assert.equal(validateRustParserReply(reply, inputs, identity)[0].sourceHash, "source-hash");
  assert.throws(() => validateRustParserReply({ ...reply, parserSource: "stale" }, inputs, identity), /stale/);
  assert.throws(() => validateRustParserReply({ ...reply, rows: [{ ...row, file: "outside.rs" }] }, inputs, identity), /unknown/);
  assert.throws(() => validateRustParserReply({ ...reply, rows: [] }, inputs, identity), /missing/);
});

test("source and removed rows invalidate recorded inventory; output deterministic", (t) => {
  const root = fixture(t, { "src/a.ts": 'import { spawn } from "node:child_process"; spawn("node", []);' });
  const rows = discoverBoundaries(root);
  assert.deepEqual(discoverBoundaries(root), rows);
  assert.deepEqual(compareInventory(rows, rows), { missing: [], changed: [], removed: [] });
  writeFileSync(path.join(root, "src/a.ts"), 'import { spawn } from "node:child_process"; spawn("other", []);');
  const comparison = compareInventory(discoverBoundaries(root), rows);
  assert.ok(comparison.changed.length + comparison.missing.length > 0);
  assert.equal(compareInventory([], rows).removed.length, rows.length);
});

test("comments and inert strings are not calls; no repository source is executed", (t) => {
  const root = fixture(t, { "src/inert.ts": '// spawn("node");\nconst example = `require("child_process").spawn()`; throw new Error("must not run");' });
  assert.ok(discoverBoundaries(root).every((row) => row.kind !== "call"));
});

test("unclassified JS source cannot disappear from the source drift catalogue", (t) => {
  const root = fixture(t, { "src/unknown.js": 'const run = (0, eval); run(input);' });
  const before = discoverBoundaries(root);
  assert.ok(before.some((r) => r.file === "src/unknown.js" && r.kind === "source-review"));
  writeFileSync(path.join(root, "src/unknown.js"), 'module.require("child_process").spawn("node");');
  const drift = compareInventory(discoverBoundaries(root), before);
  assert.ok(drift.changed.length + drift.missing.length + drift.removed.length > 0);
});

test("unclassified Python source also retains a review obligation", (t) => {
  const root = fixture(t, { "scripts/unknown.py": 'callback = globals()[name]\ncallback(value)\n' });
  assert.ok(discoverBoundaries(root).some((r) => r.file === "scripts/unknown.py" && r.kind === "source-review"));
});

test("symlinked files and directories are obligations without following targets", (t) => {
  const root = fixture(t, { "src/a.ts": "export {};" });
  symlinkSync(tmpdir(), path.join(root, "src/outside"));
  symlinkSync(path.join(root, "src/a.ts"), path.join(root, "src/link.ts"));
  const rows = discoverBoundaries(root);
  assert.equal(rows.filter((r) => r.kind === "symlink-review").length, 2);
  assert.ok(rows.every((r) => ["src/a.ts", "src/outside", "src/link.ts"].includes(r.file)));
});

test("registered discovery cannot count as a proven contract", (t) => {
  const root = fixture(t, { "src/run.ts": 'import { spawn } from "child_process"; spawn("node");' });
  const rows = discoverBoundaries(root);
  const audit = auditContracts(rows, rows);
  assert.ok(audit.invalid.length > 0, "every row needs an explicit contract record");
  const pending = rows.map((r) => ({ ...r, contract: { status: "unverified", reason: "Awaiting per-boundary review" } }));
  assert.equal(auditContracts(rows, pending).invalid.length, 0);
  assert.equal(auditContracts(rows, pending).unverified.length, rows.length);
  const forged = rows.map((r) => ({ ...r, contract: { status: "verified" } }));
  assert.equal(auditContracts(rows, forged).invalid.length, rows.length);
});

test("duplicate IDs and mismatched source cannot pass a contract audit", (t) => {
  const root = fixture(t, { "src/run.ts": 'import { spawn } from "child_process"; spawn("node");' });
  const rows = discoverBoundaries(root);
  const pending = rows.map((r) => ({ ...r, contract: { status: "unverified", reason: "Awaiting review" } }));
  assert.ok(auditContracts(rows, [...pending, pending[0]]).invalid.length > 0);
  pending[0].sourceHash = "old-source";
  assert.ok(auditContracts(rows, pending).drift.changed.length > 0);
});

test("compact file catalogue retains every source/position and pending contract", (t) => {
  const root = fixture(t, { "src/a.ts": 'import cp from "child_process"; cp.spawn("node"); cp.execFile("node");' });
  const rows = discoverBoundaries(root);
  const packed = packInventory(rows);
  const unpacked = unpackInventory(JSON.parse(JSON.stringify(packed)));
  assert.deepEqual(unpacked.map(({ contract, ...row }) => row), rows);
  assert.equal(auditContracts(rows, unpacked).unverified.length, rows.length);
  assert.throws(() => unpackInventory({ schemaVersion: 10, files: {} }), /schema/);
});
