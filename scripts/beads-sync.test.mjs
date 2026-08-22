import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { runBeadsSync } from "./beads-sync.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "beads-sync-"));
  const bin = join(root, "bin");
  const log = join(root, "bd-log.jsonl");
  const descendantPid = join(root, "descendant.pid");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "bd"),
    `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const phase = args[1];
appendFileSync(
  process.env.BD_FAKE_LOG,
  JSON.stringify({
    args,
    gitTerminalPrompt: process.env.GIT_TERMINAL_PROMPT,
    gcmInteractive: process.env.GCM_INTERACTIVE,
  }) + "\\n",
);

if (phase === "pull") {
  process.stdout.write("pull ok\\n");
  process.stderr.write("pull note\\n");
  process.exit(Number(process.env.BD_FAKE_PULL_EXIT ?? "0"));
}

if (process.env.BD_FAKE_PUSH_HANG === "1") {
  const descendant = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    { stdio: "ignore" },
  );
  writeFileSync(process.env.BD_FAKE_DESCENDANT_PID, String(descendant.pid));
  process.on("SIGTERM", () => {});
  await new Promise(() => {});
}

process.stdout.write("push ok\\n");
process.stderr.write("push note\\n");
process.exit(Number(process.env.BD_FAKE_PUSH_EXIT ?? "0"));
`,
    "utf8",
  );
  chmodSync(join(bin, "bd"), 0o755);
  return {
    root,
    log,
    descendantPid,
    env: {
      ...process.env,
      PATH: `${bin}${process.env.PATH ? `${delimiter}${process.env.PATH}` : ""}`,
      BD_FAKE_LOG: log,
      BD_FAKE_DESCENDANT_PID: descendantPid,
    },
  };
}

function readLog(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function outputSink() {
  let value = "";
  return {
    write(chunk) {
      value += chunk;
    },
    text() {
      return value;
    },
  };
}

test("sync runs pull before push with noninteractive credential settings", async () => {
  const current = fixture();
  const stdout = outputSink();
  const stderr = outputSink();
  try {
    const status = await runBeadsSync({
      env: current.env,
      writeStdout: (value) => stdout.write(value),
      writeStderr: (value) => stderr.write(value),
    });

    assert.equal(status, 0, stderr.text());
    assert.deepEqual(
      readLog(current.log),
      [
        {
          args: ["dolt", "pull"],
          gitTerminalPrompt: "0",
          gcmInteractive: "Never",
        },
        {
          args: ["dolt", "push"],
          gitTerminalPrompt: "0",
          gcmInteractive: "Never",
        },
      ],
    );
    assert.match(stdout.text(), /\[beads:sync\] pull/);
    assert.match(stdout.text(), /pull ok/);
    assert.match(stdout.text(), /\[beads:sync\] push/);
    assert.match(stdout.text(), /push ok/);
    assert.match(stderr.text(), /pull note/);
    assert.match(stderr.text(), /push note/);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("pull failure preserves its status and never starts push", async () => {
  const current = fixture();
  const stderr = outputSink();
  try {
    const status = await runBeadsSync({
      env: { ...current.env, BD_FAKE_PULL_EXIT: "7" },
      writeStdout: () => {},
      writeStderr: (value) => stderr.write(value),
    });

    assert.equal(status, 7);
    assert.deepEqual(
      readLog(current.log).map((entry) => entry.args),
      [["dolt", "pull"]],
    );
    assert.match(stderr.text(), /pull exited with status 7/);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("push failure preserves its status and prints safe retry guidance", async () => {
  const current = fixture();
  const stderr = outputSink();
  try {
    const status = await runBeadsSync({
      env: { ...current.env, BD_FAKE_PUSH_EXIT: "9" },
      writeStdout: () => {},
      writeStderr: (value) => stderr.write(value),
    });

    assert.equal(status, 9);
    assert.deepEqual(
      readLog(current.log).map((entry) => entry.args),
      [["dolt", "pull"], ["dolt", "push"]],
    );
    assert.match(stderr.text(), /push exited with status 9/);
    assert.match(stderr.text(), /Retry `pnpm beads:sync` once/);
    assert.match(stderr.text(), /refs\/dolt\/data/);
    assert.match(stderr.text(), /Do not edit Git configuration or credential helpers/);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

async function waitForMissingProcess(pid, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

test("push timeout kills a descendant that ignores SIGTERM", {
  skip: process.platform === "win32",
}, async () => {
  const current = fixture();
  const stderr = outputSink();
  try {
    const status = await runBeadsSync({
      env: { ...current.env, BD_FAKE_PUSH_HANG: "1" },
      timeoutMs: 1_000,
      terminationGraceMs: 200,
      writeStdout: () => {},
      writeStderr: (value) => stderr.write(value),
    });

    assert.equal(status, 124, stderr.text());
    const pid = Number(readFileSync(current.descendantPid, "utf8"));
    assert.equal(await waitForMissingProcess(pid), true, `descendant ${pid} survived timeout`);
    assert.match(stderr.text(), /push timed out after 1000ms/);
    assert.match(stderr.text(), /owned process tree terminated/);
    assert.match(stderr.text(), /Retry `pnpm beads:sync` once/);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("unproven tree cleanup is a hard error, not an ordinary timeout", async () => {
  const stderr = outputSink();
  const fakeChild = new EventEmitter();
  fakeChild.pid = 424242;
  fakeChild.exitCode = null;
  fakeChild.signalCode = null;
  fakeChild.stdout = new PassThrough();
  fakeChild.stderr = new PassThrough();

  const status = await runBeadsSync({
    timeoutMs: 1,
    spawnProcess: () => fakeChild,
    terminateTree: async () => false,
    writeStdout: () => {},
    writeStderr: (value) => stderr.write(value),
  });

  assert.equal(status, 1);
  assert.match(stderr.text(), /could not prove process-tree cleanup/);
  assert.doesNotMatch(stderr.text(), /owned process tree terminated/);
});
