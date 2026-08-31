import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  launchOwnedProcess,
  readProcessOwner,
} from "./mobile-process-ownership.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const identityBinary = join(scriptsDir, `.mobile-process-identity-shell-test-${process.pid}`);
process.env.COVEN_CAVE_PROCESS_IDENTITY_BIN = identityBinary;
test.after(() => rmSync(identityBinary, { force: true }));
const repoRoot = join(scriptsDir, "..");
const scriptPath = join(scriptsDir, "mobile-tailscale.sh");
const script = readFileSync(
  scriptPath,
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
);
const recovery = readFileSync(
  fileURLToPath(new URL("./mobile-recovery.sh", import.meta.url)),
  "utf8",
);
const serveOwnershipHelper = fileURLToPath(
  new URL("./mobile-serve-ownership.ts", import.meta.url),
);

function installServeOwnershipShim(fixture, outcomes) {
  const helper = join(fixture, "serve-ownership-shim.mjs");
  const log = join(fixture, "serve-ownership.log");
  writeFileSync(
    helper,
    `import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const backend = value("--backend");
const outcome = ${JSON.stringify(outcomes)}[backend] ?? "not-owned";
if (outcome === "removed") {
  const state = value("--process-owner");
  const stopped = spawnSync(process.execPath, [
    "--experimental-strip-types",
    process.env.COVEN_CAVE_PROCESS_OWNERSHIP_HELPER,
    "stop",
    "--state",
    state,
  ], { encoding: "utf8" });
  if (stopped.status !== 0) {
    process.stdout.write(JSON.stringify({ kind: "process-cleanup-failed", backendUrl: backend, stderr: stopped.stdout.trim() }) + "\\n");
    process.exit(12);
  }
  process.stdout.write(JSON.stringify({ kind: "removed", backendUrl: backend }) + "\\n");
  process.exit(0);
}
process.stdout.write(JSON.stringify({ kind: "not-owned", backendUrl: backend }) + "\\n");
process.exit(10);
`,
  );
  return { helper, log };
}

test("mobile tailscale runner exposes operator commands", () => {
  assert.match(script, /COMMAND="\$\{1:-start\}"/);
  assert.match(script, /start\|invite\|app\|status\|stop/);
  assert.match(packageJson.scripts["mobile:tailscale"], /mobile-tailscale\.sh start/);
  assert.match(packageJson.scripts["mobile:tailscale:invite"], /mobile-tailscale\.sh invite/);
  assert.match(packageJson.scripts["mobile:tailscale:app"], /mobile-tailscale\.sh app/);
  assert.match(packageJson.scripts["mobile:tailscale:status"], /mobile-tailscale\.sh status/);
  assert.match(packageJson.scripts["mobile:tailscale:stop"], /mobile-tailscale\.sh stop/);
});

test("mobile tailscale app mode serves the native client with an access token", () => {
  // The native-app path exposes the full API through Tailscale Serve, so it must
  // mint/load a mobile access token and only clear sidecar/bundle trust.
  assert.match(script, /CAVE_MOBILE_APP/);
  assert.match(script, /app\) resolve_active_port; maybe_fallback_port; app_command ;;/);
  assert.match(script, /load_or_create_token/);
  assert.match(script, /COVEN_CAVE_ACCESS_TOKEN="\$ACCESS_TOKEN"/);
  assert.match(script, /-u COVEN_CAVE_AUTH_TOKEN -u COVEN_CAVE_BUNDLE -u COVEN_CAVE_TAILNET_TRUST/);
  assert.match(script, /coven_access_token/);
  assert.match(script, /HOSTNAME="\$HOST"/);
  assert.match(script, /PORT="\$PORT"/);
});

test("mobile tailscale runner can use an explicit Tailscale binary", () => {
  assert.match(script, /TAILSCALE_BIN="\$\{TAILSCALE_BIN:-tailscale\}"/);
  assert.match(script, /node - "\$TAILSCALE_TIMEOUT_MS" "\$TAILSCALE_BIN" "\$@"/);
  assert.match(script, /const \[timeoutMsRaw, bin, \.\.\.args\]/);
  assert.match(script, /spawnSync\(bin, args/);
  assert.match(script, /need "\$TAILSCALE_BIN"/);
  assert.match(script, /command -v "\$TAILSCALE_BIN"/);
});

test("mobile tailscale app mode fails closed when HTTPS Serve is unavailable", () => {
  assert.match(script, /Could not determine an HTTPS Tailscale Serve URL/);
  assert.doesNotMatch(script, /tailscale_cmd serve --bg --http=/);
  assert.doesNotMatch(script, /APP_URL="http:\/\//);
  assert.doesNotMatch(script, /serve_url_from_status\(\)/);
  assert.match(
    script,
    /"\$SERVE_OWNERSHIP_HELPER" url[\s\S]{0,120}?--backend "\$TAILSCALE_BACKEND"/,
  );
});

test("supported shell mutations use the canonical Serve ownership executable", () => {
  assert.equal(
    existsSync(serveOwnershipHelper),
    true,
    "the shared structured Serve ownership executable exists",
  );
  assert.match(script, /"\$SERVE_OWNERSHIP_HELPER" claim\s+\\?\s*--backend "\$TAILSCALE_BACKEND" --channel dev/);
  assert.match(script, /"\$SERVE_OWNERSHIP_HELPER" reset\s+\\?\s*--backend "\$backend" --channel dev --process-owner "\$owner_file"/);
  assert.doesNotMatch(script, /tailscale_cmd serve --bg/);
  assert.doesNotMatch(script, /tailscale_cmd serve reset/);
  assert.match(recovery, /mobile-serve-ownership\.ts" claim\s+\\?\s*--backend "\$backend" --channel packaged/);
  assert.doesNotMatch(recovery, /"\$TAILSCALE_BIN" serve --bg/);
  assert.match(recovery, /"kind":"(?:owned|claimed)"/);
});

test("mobile tailscale stop preserves a tracked backend after foreign reassignment", () => {
  assert.match(
    script,
    /"kind":"not-owned"[\s\S]{0,240}?"\$serve_status" -ne 10[\s\S]{0,500}?preserving the tracked backend process/,
  );
  assert.match(
    script,
    /--process-owner "\$owner_file"/,
    "the Serve helper owns process cleanup while its machine lease is held",
  );
});

test("mobile tailscale stop retains a tracked process after a not-owned reset", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-tailscale-stop-"));
  const stateRoot = join(fixture, "state");
  const stateDir = join(stateRoot, "mobile-tailscale-3000");
  mkdirSync(stateDir, { recursive: true });
  const shim = installServeOwnershipShim(fixture, {
    "http://127.0.0.1:3000": "not-owned",
  });

  const ownerPath = join(stateDir, "next.owner.json");
  const launched = await launchOwnedProcess({
    ownerPath,
    backendUrl: "http://127.0.0.1:3000",
    cwd: fixture,
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    logPath: join(stateDir, "next.log"),
    env: process.env,
  });
  assert.equal(launched.kind, "launched");
  const sleeperOwner = readProcessOwner(ownerPath);
  const sleeperPid = sleeperOwner.child.pid;
  const supervisorPid = sleeperOwner.supervisor.pid;

  try {
    const result = spawnSync("bash", [scriptPath, "stop"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        HOME: fixture,
        PORT: "3000",
        HOST: "127.0.0.1",
        COVEN_CAVE_MOBILE_STATE_ROOT: stateRoot,
        COVEN_CAVE_MOBILE_STATE_DIR: stateDir,
        COVEN_CAVE_SERVE_OWNERSHIP_HELPER: shim.helper,
        COVEN_CAVE_PROCESS_OWNERSHIP_HELPER: join(scriptsDir, "mobile-process-ownership.ts"),
      },
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.match(result.stderr, /preserving the tracked backend process/);
    assert.doesNotThrow(
      () => process.kill(sleeperPid, 0),
      "a foreign Serve reassignment must preserve the tracked backend process",
    );
    assert.equal(existsSync(ownerPath), true);
  } finally {
    try {
      process.kill(-supervisorPid, "SIGKILL");
    } catch {}
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("mobile tailscale stop never signals a reused foreign PID", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-tailscale-stale-pid-"));
  const stateRoot = join(fixture, "state");
  const stateDir = join(stateRoot, "mobile-tailscale-3000");
  mkdirSync(stateDir, { recursive: true });
  const shim = installServeOwnershipShim(fixture, {
    "http://127.0.0.1:3000": "removed",
  });

  const ownerPath = join(stateDir, "next.owner.json");
  const launched = await launchOwnedProcess({
    ownerPath,
    backendUrl: "http://127.0.0.1:3000",
    cwd: fixture,
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    logPath: join(stateDir, "next.log"),
    env: process.env,
  });
  assert.equal(launched.kind, "launched");
  const foreignOwner = readProcessOwner(ownerPath);
  const foreignPid = foreignOwner.child.pid;
  const supervisorPid = foreignOwner.supervisor.pid;
  writeFileSync(ownerPath, JSON.stringify({
    ...foreignOwner,
    supervisor: {
      ...foreignOwner.supervisor,
      processToken: "macos:999999:1:1",
    },
  }));

  try {
    const result = spawnSync("bash", [scriptPath, "stop"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        HOME: fixture,
        PORT: "3000",
        HOST: "127.0.0.1",
        COVEN_CAVE_MOBILE_STATE_ROOT: stateRoot,
        COVEN_CAVE_MOBILE_STATE_DIR: stateDir,
        COVEN_CAVE_SERVE_OWNERSHIP_HELPER: shim.helper,
        COVEN_CAVE_PROCESS_OWNERSHIP_HELPER: join(scriptsDir, "mobile-process-ownership.ts"),
      },
    });
    assert.notEqual(result.status, 0, "unverified process cleanup must fail closed");
    assert.doesNotThrow(
      () => process.kill(foreignPid, 0),
      "a stale state file must not authorize signaling a reused foreign PID",
    );
    assert.equal(existsSync(ownerPath), true, "failed cleanup retains retryable owner state");
  } finally {
    try {
      process.kill(-supervisorPid, "SIGKILL");
    } catch {}
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("default stop evaluates each tracked backend identity independently", async () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-tailscale-multi-stop-"));
  const stateRoot = join(fixture, "state");
  const ipv6Dir = join(stateRoot, "mobile-tailscale-3007");
  const ipv4Dir = join(stateRoot, "mobile-tailscale-3008");
  mkdirSync(ipv6Dir, { recursive: true });
  mkdirSync(ipv4Dir, { recursive: true });
  const shim = installServeOwnershipShim(fixture, {
    "http://[::1]:3007": "not-owned",
    "http://127.0.0.1:3008": "removed",
  });
  const ipv6Owner = join(ipv6Dir, "next.owner.json");
  const ipv4Owner = join(ipv4Dir, "next.owner.json");
  const ipv6Launch = await launchOwnedProcess({
    ownerPath: ipv6Owner,
    backendUrl: "http://[::1]:3007",
    cwd: fixture,
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    logPath: join(ipv6Dir, "next.log"),
    env: process.env,
  });
  const ipv4Launch = await launchOwnedProcess({
    ownerPath: ipv4Owner,
    backendUrl: "http://127.0.0.1:3008",
    cwd: fixture,
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    logPath: join(ipv4Dir, "next.log"),
    env: process.env,
  });
  assert.equal(ipv6Launch.kind, "launched");
  assert.equal(ipv4Launch.kind, "launched");
  const ipv6State = readProcessOwner(ipv6Owner);
  const ipv4State = readProcessOwner(ipv4Owner);
  const ipv6Pid = ipv6State.child.pid;
  const ipv4Pid = ipv4State.child.pid;
  const ipv6SupervisorPid = ipv6State.supervisor.pid;
  const ipv4SupervisorPid = ipv4State.supervisor.pid;
  assert.equal(
    JSON.parse(readFileSync(ipv6Owner, "utf8")).backendUrl,
    "http://[::1]:3007",
    "the IPv6 start path persists its exact normalized backend identity",
  );
  writeFileSync(join(ipv4Dir, "access-token"), "dev-secret");
  writeFileSync(join(ipv4Dir, "sidecar-auth-token"), "packaged-secret");
  try {
    const result = spawnSync("bash", [scriptPath, "stop"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        HOME: fixture,
        COVEN_CAVE_MOBILE_STATE_ROOT: stateRoot,
        COVEN_CAVE_SERVE_OWNERSHIP_HELPER: shim.helper,
        COVEN_CAVE_PROCESS_OWNERSHIP_HELPER: join(scriptsDir, "mobile-process-ownership.ts"),
      },
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const calls = readFileSync(shim.log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      calls.map((args) => args[args.indexOf("--backend") + 1]).sort(),
      ["http://127.0.0.1:3008", "http://[::1]:3007"],
    );
    assert.doesNotThrow(() => process.kill(ipv6Pid, 0));
    assert.equal(existsSync(ipv6Owner), true, "foreign IPv6 reassignment remains tracked and alive");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.throws(
      () => process.kill(ipv4Pid, 0),
      (error) => error?.code === "ESRCH",
      "owned IPv4 process is terminated by the lease-held reset callback",
    );
    assert.equal(existsSync(ipv4Owner), false, "verified removal deletes only owned state");
    assert.equal(existsSync(join(ipv4Dir, "access-token")), false);
    assert.equal(
      existsSync(join(ipv4Dir, "sidecar-auth-token")),
      true,
      "verified dev cleanup preserves packaged sidecar credentials",
    );
  } finally {
    try {
      process.kill(-ipv6SupervisorPid, "SIGKILL");
    } catch {}
    try {
      process.kill(-ipv4SupervisorPid, "SIGKILL");
    } catch {}
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("IPv6 readiness recognizes the canonical bracketed backend URL", () => {
  const fixture = mkdtempSync(join(scriptsDir, ".mobile-tailscale-ipv6-ready-"));
  const logFile = join(fixture, "next.log");
  writeFileSync(logFile, "> Ready on http://[::1]:3000\n");
  try {
    const result = spawnSync(
      "bash",
      ["-c", 'source "$1"; server_logged_ready', "mobile-tailscale-test", scriptPath],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: fixture,
          HOST: "::1",
          PORT: "3000",
          COVEN_CAVE_MOBILE_LOG: logFile,
          COVEN_CAVE_MOBILE_STATE_DIR: join(fixture, "state"),
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("mobile tailscale app mode records ownership separately from sidecar tokens", () => {
  assert.match(script, /MODE_FILE=/);
  assert.match(script, /write_server_mode app/);
  assert.match(script, /recorded_server_mode_is app/);
  assert.match(script, /rm -f "\$SIDECAR_TOKEN_FILE"/);
});

test("mobile tailscale app mode takes over an untracked same-checkout dev server", () => {
  assert.match(script, /take_over_same_checkout_server_for_app\(\)/);
  assert.match(script, /\[ "\$COMMAND" != "app" \]/);
  assert.match(script, /occupant_is_this_checkout/);
  assert.match(script, /kill "\$OCCUPANT_PID"/);
  assert.match(script, /wait_for_port_to_clear "\$PORT"/);
  assert.match(script, /Taking over untracked same-checkout dev server/);
});

test("mobile tailscale runner persists state for remote invite regeneration", () => {
  assert.match(script, /STATE_DIR=/);
  assert.match(script, /TOKEN_FILE=/);
  assert.match(script, /OWNER_FILE=.*next\.owner\.json/);
  assert.match(script, /"\$PROCESS_OWNERSHIP_HELPER" launch/);
  assert.match(script, /INVITE_FILE=/);
  assert.match(script, /chmod 700 "\$STATE_DIR"/);
  assert.match(script, /chmod 600 "\$TOKEN_FILE"/);
});

test("mobile tailscale runner refuses untracked localhost listeners", () => {
  assert.match(script, /recorded_server_is_running\(\)/);
  assert.match(script, /require_recorded_server\(\)/);
  assert.match(script, /Refusing to contact an untracked server/);
  assert.match(script, /process_owner_cmd matches/);
});

test("mobile tailscale status warns when Serve points at another backend", () => {
  assert.match(script, /warn_if_serve_targets_other_backend\(\)/);
  assert.match(script, /Tailscale Serve is not pointing at/);
  assert.match(script, /current proxy target/);
  assert.match(script, /warn_if_serve_targets_other_backend/);
});

test("mobile tailscale invite flow does not send the raw persisted token", () => {
  assert.match(script, /CONTROL_TOKEN_TTL_MS/);
  assert.match(script, /createMobileAccessToken\(accessToken\)/);
  assert.doesNotMatch(script, /Bearer \$\{accessToken\}/);
});

test("mobile tailscale runner keeps dev server alive after the wrapper exits", () => {
  assert.match(
    script,
    /"\$PROCESS_OWNERSHIP_HELPER" launch[\s\S]{0,260}?--backend "\$\(backend_url\)"[\s\S]{0,260}?-- pnpm dev/,
  );
  assert.doesNotMatch(script, /tmux new-session -d/);
  assert.doesNotMatch(script, /nohup env COVEN_CAVE_ACCESS_TOKEN=/);
});

test("mobile tailscale invite command is chat-safe by default", () => {
  assert.match(script, /copy_invite_to_clipboard/);
  assert.match(script, /PRINT_URL="\$\{PRINT_URL:-0\}"/);
  assert.match(script, /Raw invite URL suppressed/);
  assert.doesNotMatch(script, /Open this URL on your phone:/);
});

test("mobile tailscale readiness requires this server's ready log", () => {
  assert.match(script, /server_logged_ready\(\)/);
  assert.match(script, /grep -F "> Ready on \$\(backend_url\)" "\$LOG_FILE"/);
  assert.match(script, /recorded_server_is_running && port_is_listening.*&& server_logged_ready/);
});

test("mobile tailscale runner syntax is shell-checkable by bash", () => {
  assert.match(script, /set -euo pipefail/);
});

console.log("mobile-tailscale.test.mjs OK");
