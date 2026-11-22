import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "cave-write-scope-refresh-"));
const previous = process.env.COVEN_BIN;
const binary = path.join(directory, process.platform === "win32" ? "coven.cmd" : "coven");
const script = path.join(directory, "help.cjs");
async function install(supported: boolean, fail = false, oversized = false) {
  const help = supported ? "--permission --write-scope <FILE>" : "--permission";
  await writeFile(script, `console.log(${JSON.stringify(help)}); ${oversized ? 'process.stdout.write("x".repeat(70_000));' : ""} process.exit(${fail ? 1 : 0});\n`);
  await writeFile(binary, process.platform === "win32"
    ? `@"${process.execPath}" "${script}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
}
try {
  await install(false);
  process.env.COVEN_BIN = binary;
  const { covenRunSupportsWriteScope } = await import("./chat-send-capabilities.ts");
  assert.equal(await covenRunSupportsWriteScope(), false);
  await install(true);
  assert.equal(await covenRunSupportsWriteScope(), true, "an in-place Coven replacement must clear a negative capability answer without restarting Cave");
  await install(false);
  assert.equal(await covenRunSupportsWriteScope(), false, "a downgrade must never inherit previously supported scoped writes");
  await install(true, true);
  assert.equal(await covenRunSupportsWriteScope(), false, "failed help output is never authority to launch");
  await install(true);
  assert.equal(await covenRunSupportsWriteScope(), true, "a transient probe failure must be recoverable");
  await install(true, false, true);
  assert.equal(await covenRunSupportsWriteScope(), false, "oversized or truncated help is not complete capability evidence");
} finally {
  if (previous === undefined) delete process.env.COVEN_BIN;
  else process.env.COVEN_BIN = previous;
  await rm(directory, { recursive: true, force: true });
}
console.log("coven-write-scope-refresh: ok");
