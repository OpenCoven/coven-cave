// Interrupting the dev launcher must not strand the process tree it owns.
// A stranded Next dev server keeps the port bound, so the next `pnpm dev:app`
// silently attaches the desktop shell to the previous run's stale server.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Node maps SIGTERM/SIGINT to forced termination on native Windows, bypassing
// the Bash traps this test is intended to exercise. Keep signal-tree coverage
// on POSIX, where its delivery semantics are real rather than simulated.
if (process.platform === "win32") {
  console.log("dev-app-teardown: skipped on native Windows (Bash signal traps are not observable through Node signals)");
  process.exit(0);
}

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function probePort(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const settle = (listening) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(300);
    socket.on("connect", () => settle(true));
    socket.on("timeout", () => settle(false));
    socket.on("error", () => settle(false));
  });
}

async function waitFor(predicate, { timeoutMs = 20_000, label }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(100);
  }
  assert.fail(`timed out waiting for ${label}`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const root = mkdtempSync(path.join(tmpdir(), "dev-app-teardown-"));
const fakeScripts = path.join(root, "scripts");
const fakeBin = path.join(root, "bin");
mkdirSync(fakeScripts, { recursive: true });
mkdirSync(fakeBin, { recursive: true });

copyFileSync(path.join(scriptsDir, "dev-app.sh"), path.join(fakeScripts, "dev-app.sh"));
chmodSync(path.join(fakeScripts, "dev-app.sh"), 0o755);
writeFileSync(path.join(fakeScripts, "whisper-runtime-dev-env.sh"), "# stub for tests\n");

const fakePnpm = (port, pidFile) => `#!/usr/bin/env bash
echo "tauri $$" >>"${pidFile}"
node -e '
  const net = require("net");
  const fs = require("fs");
  const server = net.createServer(() => {});
  server.listen(${port}, "127.0.0.1", () => {
    fs.appendFileSync("${pidFile}", "server " + process.pid + "\\n");
  });
  setInterval(() => {}, 1000);
' &
child=$!
wait "$child"
`;

const readPids = (pidFile) =>
  Object.fromEntries(
    readFileSync(pidFile, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(" ")),
  );

// The signal is delivered to the launcher alone, not to its process group. A
// terminal Ctrl-C also reaches the children directly, which would hide an
// orphan; supervisors, IDE stop buttons, and `kill <pid>` do not.
async function assertTeardown(signal) {
  const port = await freePort();
  const pidFile = path.join(root, `pids-${signal}.txt`);
  writeFileSync(path.join(fakeBin, "pnpm"), fakePnpm(port, pidFile));
  chmodSync(path.join(fakeBin, "pnpm"), 0o755);

  const wrapper = spawn("bash", [path.join(fakeScripts, "dev-app.sh")], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      PORT: String(port),
      COVEN_CAVE_AUTH_TOKEN: "",
      COVEN_CAVE_DEV_SERVER_GRACE_SECONDS: "0",
    },
  });
  wrapper.unref();

  let pids = {};
  try {
    await waitFor(() => probePort(port), {
      label: `the fake dev server to bind port ${port}`,
    });
    pids = readPids(pidFile);
    assert.ok(pids.tauri, "the launcher must actually start the Tauri child");
    assert.ok(pids.server, "the Tauri child must own the dev server process");

    process.kill(wrapper.pid, signal);

    await waitFor(() => !isAlive(wrapper.pid), {
      label: `the launcher to exit after ${signal}`,
    });
    await waitFor(async () => !(await probePort(port)), {
      label: `port ${port} to be released after ${signal}`,
    });

    assert.equal(
      isAlive(Number(pids.tauri)),
      false,
      `${signal} to the launcher must not strand the Tauri process`,
    );
    assert.equal(
      isAlive(Number(pids.server)),
      false,
      `${signal} to the launcher must not strand the dev server it owns`,
    );
  } finally {
    for (const pid of [wrapper.pid, Number(pids.tauri), Number(pids.server)]) {
      if (Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
    }
  }
}

try {
  await assertTeardown("SIGTERM");
  await assertTeardown("SIGINT");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("dev-app-teardown: ok");
