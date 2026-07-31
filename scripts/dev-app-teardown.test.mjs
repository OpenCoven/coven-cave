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
copyFileSync(path.join(scriptsDir, "dev-app-origin-health.mjs"), path.join(fakeScripts, "dev-app-origin-health.mjs"));
chmodSync(path.join(fakeScripts, "dev-app.sh"), 0o755);
writeFileSync(path.join(fakeScripts, "whisper-runtime-dev-env.sh"), "# stub for tests\n");

const fakePnpm = (port, pidFile) => `#!/usr/bin/env bash
if [ "$1" = "dev" ]; then
echo "server $$" >>"${pidFile}"
node -e '
  const http = require("http");
  const fs = require("fs");
  const server = http.createServer((request, response) => {
    response.writeHead(204);
    response.end();
  });
  server.listen(${port}, "127.0.0.1", () => {
    fs.appendFileSync("${pidFile}", "server " + process.pid + "\\n");
  });
  setInterval(() => {}, 1000);
' &
child=$!
wait "$child"
else
echo "tauri $$" >>"${pidFile}"
node -e "setInterval(() => {}, 1000)" &
child=$!
wait "$child"
fi
`;

const fakeHungPnpm = (port, pidFile) => `#!/usr/bin/env bash
echo "server_command $$" >>"${pidFile}"
node -e '
  const net = require("net");
  const fs = require("fs");
  const server = net.createServer(() => {});
  server.listen(${port}, "127.0.0.1", () => {
    fs.appendFileSync("${pidFile}", "origin " + process.pid + "\\n");
  });
  setInterval(() => {}, 1000);
' &
child=$!
wait "$child"
`;

const fakeUnavailablePnpm = (pidFile) => `#!/usr/bin/env bash
echo "server_command $$" >>"${pidFile}"
exit 0
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
      COVEN_CAVE_DEV_SERVER_GRACE_SECONDS: "2",
    },
  });
  wrapper.unref();

  let pids = {};
  try {
    await waitFor(() => probePort(port), {
      label: `the fake dev server to bind port ${port}`,
    });
    await waitFor(() => {
      pids = readPids(pidFile);
      return Boolean(pids.tauri && pids.server);
    }, {
      label: "the launcher to complete HTTP readiness and start the Tauri child",
    });
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

async function assertHungOriginStopsOwnedTree() {
  const port = await freePort();
  const pidFile = path.join(root, "pids-hung-origin.txt");
  writeFileSync(path.join(fakeBin, "pnpm"), fakeHungPnpm(port, pidFile));
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
      COVEN_CAVE_DEV_SERVER_GRACE_SECONDS: "2",
    },
  });
  wrapper.unref();

  let pids = {};
  try {
    await waitFor(() => probePort(port), {
      label: `the HTTP-hung fake origin to bind port ${port}`,
    });
    pids = readPids(pidFile);
    assert.ok(pids.server_command, "the launcher must start the owned HTTP-hung origin before judging it");
    assert.ok(pids.origin, "the owned dev-server command must own the HTTP-hung origin process");

    await waitFor(() => !isAlive(wrapper.pid), {
      timeoutMs: 12_000,
      label: "the launcher to exit after its bounded HTTP readiness grace period",
    });
    await waitFor(async () => !(await probePort(port)), {
      label: `port ${port} to be released when the HTTP-hung origin is rejected`,
    });

    assert.equal(isAlive(Number(pids.server_command)), false, "preflight failure must stop the owned dev-server command");
    assert.equal(isAlive(Number(pids.origin)), false, "preflight failure must not leave the rejected origin process alive");
  } finally {
    for (const pid of [wrapper.pid, Number(pids.server_command), Number(pids.origin)]) {
      if (Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
    }
  }
}

async function assertUnavailableOriginNeverOpensTauri() {
  const port = await freePort();
  const pidFile = path.join(root, "pids-unavailable-origin.txt");
  writeFileSync(path.join(fakeBin, "pnpm"), fakeUnavailablePnpm(pidFile));
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
      COVEN_CAVE_DEV_SERVER_GRACE_SECONDS: "2",
    },
  });
  wrapper.unref();

  try {
    await waitFor(() => !isAlive(wrapper.pid), {
      timeoutMs: 12_000,
      label: "the launcher to exit when its selected loopback origin never becomes available",
    });
    const records = readFileSync(pidFile, "utf8");
    assert.match(records, /server_command/, "the launcher must attempt to start its selected dev server");
    assert.doesNotMatch(records, /tauri/, "an unavailable origin must fail before Tauri can open a black window");
    assert.equal(await probePort(port), false, "an unavailable selected port must remain unavailable after preflight failure");
  } finally {
    try {
      process.kill(wrapper.pid, "SIGKILL");
    } catch {}
  }
}

try {
  await assertTeardown("SIGTERM");
  await assertTeardown("SIGINT");
  await assertHungOriginStopsOwnedTree();
  await assertUnavailableOriginNeverOpensTauri();
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("dev-app-teardown: ok");
