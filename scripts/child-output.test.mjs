import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { collectOutput } from "./child-output.mjs";

test("retains the leading failure diagnosis and final output under verbose child output", () => {
  const child = { stdout: new PassThrough(), stderr: new PassThrough() };
  const output = collectOutput(child);
  child.stderr.write("status: 1, signal: null, killed: false\n");
  for (let i = 0; i < 100; i += 1) child.stderr.write("PowerShell script body\n".repeat(100));
  child.stderr.write("stdout: '', stderr: ''\n");
  assert.match(output(), /^status: 1, signal: null, killed: false/);
  assert.match(output(), /stdout: '', stderr: ''\n$/);
  assert.ok(output().length < 33_000, "diagnostics must remain bounded");
});

test("preserves short interleaved output without duplication", () => {
  const child = { stdout: new PassThrough(), stderr: new PassThrough() };
  const output = collectOutput(child);
  child.stdout.write("starting\n");
  child.stderr.write("warning\n");
  child.stdout.write("ready\n");
  assert.equal(output(), "starting\nwarning\nready\n");
});
