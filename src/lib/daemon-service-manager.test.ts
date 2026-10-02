// @ts-nocheck
// The launchd job that owns the Coven daemon (#5730) — detected from the
// LaunchAgents directory through injected seams, never the machine's own.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  daemonServiceConflict,
  daemonServiceRunning,
  findDaemonServiceManager,
  kickstartDaemonService,
  runsCovenDaemonServe,
  serviceDaemonTarget,
} from "./daemon-service-manager.ts";

test("recognizes `coven daemon serve` directly or through an interpreter", () => {
  assert.equal(runsCovenDaemonServe(["/Users/me/.local/bin/coven", "daemon", "serve", "--tcp", "127.0.0.1:7777"]), true);
  assert.equal(runsCovenDaemonServe(["/usr/local/bin/node", "/Users/me/.local/bin/coven.js", "daemon", "serve"]), true);
  assert.equal(runsCovenDaemonServe(["/Users/me/.local/bin/coven", "daemon", "start"]), false, "start daemonizes and exits; launchd cannot own it");
  assert.equal(runsCovenDaemonServe(["/Users/me/.local/bin/coven", "serve"]), false);
  assert.equal(runsCovenDaemonServe(["/bin/bash", "/Users/me/.coven/bin/coven-daemon-healthcheck.sh"]), false, "the watchdog is not the daemon");
  assert.equal(runsCovenDaemonServe(["/usr/bin/covenant", "daemon", "serve"]), false);
  assert.equal(runsCovenDaemonServe("coven daemon serve"), false);
  assert.equal(runsCovenDaemonServe(undefined), false);
});

const USER_AGENTS = "/Users/me/Library/LaunchAgents";
function agents(entries) {
  const dirOf = (entry) => entry.dir ?? USER_AGENTS;
  const files = new Map(entries.map((entry) => [`${dirOf(entry)}/${entry.name}`, entry]));
  const launchctlCalls = [];
  return {
    launchctlCalls,
    deps: {
      platform: "darwin",
      home: "/Users/me",
      uid: 501,
      agentDirs: [USER_AGENTS, "/Library/LaunchAgents"],
      listAgents: async (dir) => entries.filter((entry) => dirOf(entry) === dir).map((entry) => entry.name),
      readAgent: async (file) => Buffer.from(files.get(file)?.raw ?? ""),
      agentJson: async (file) => files.get(file)?.json ?? null,
      launchctl: async (args) => {
        launchctlCalls.push(args);
        const label = args[args.length - 1].split("/").pop();
        const entry = entries.find((candidate) => candidate.json?.Label === label);
        if (args[0] === "print") {
          return entry?.loaded
            ? { code: 0, stdout: `gui/501/${label} = {\n\tstate = ${entry.state ?? "running"}\n\tpid = 66961\n\t\tstate = active\n}`, stderr: "" }
            : { code: 113, stdout: "", stderr: "Could not find service" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    },
  };
}

const DAEMON = {
  name: "com.opencoven.coven-daemon.plist",
  raw: "<plist>coven daemon serve</plist>",
  loaded: true,
  json: {
    Label: "com.opencoven.coven-daemon",
    KeepAlive: true,
    ProgramArguments: ["/Users/me/.local/bin/coven", "daemon", "serve", "--tcp", "127.0.0.1:7777"],
  },
};

test("finds the loaded LaunchAgent that runs the daemon, whatever its label", async () => {
  const custom = { ...DAEMON, name: "zz.my.coven.plist", json: { ...DAEMON.json, Label: "zz.my.coven" } };
  const { deps } = agents([
    { name: "ai.opencoven.cave.plist", raw: "<plist>CovenCave</plist>", json: { Label: "ai.opencoven.cave", ProgramArguments: ["/Applications/CovenCave.app/x"] } },
    { name: "com.opencoven.coven-daemon-watchdog.plist", raw: "<plist>coven serve healthcheck</plist>", loaded: true, json: { Label: "com.opencoven.coven-daemon-watchdog", ProgramArguments: ["/bin/bash", "/Users/me/.coven/bin/coven-daemon-healthcheck.sh"] } },
    custom,
  ]);
  assert.deepEqual(await findDaemonServiceManager(deps), {
    kind: "launchd",
    label: "zz.my.coven",
    target: "gui/501/zz.my.coven",
  });
});

test("an unloaded or disabled agent manages nothing", async () => {
  assert.equal(await findDaemonServiceManager(agents([{ ...DAEMON, loaded: false }]).deps), null, "not loaded");
  assert.equal(
    await findDaemonServiceManager(agents([{ ...DAEMON, json: { ...DAEMON.json, Disabled: true } }]).deps),
    null,
    "disabled",
  );
});

test("off macOS, or with no readable LaunchAgents, there is no service", async () => {
  assert.equal(await findDaemonServiceManager({ ...agents([DAEMON]).deps, platform: "linux" }), null);
  assert.equal(await findDaemonServiceManager({ ...agents([DAEMON]).deps, platform: "win32" }), null);
  assert.equal(
    await findDaemonServiceManager({ ...agents([DAEMON]).deps, listAgents: async () => { throw new Error("ENOENT"); } }),
    null,
  );
});

test("plutil is only spawned for agents that mention coven and serve", async () => {
  let converted = 0;
  const { deps } = agents([
    { name: "a.unrelated.plist", raw: "<plist>something else</plist>", json: { Label: "a.unrelated" } },
    DAEMON,
  ]);
  const inner = deps.agentJson;
  await findDaemonServiceManager({ ...deps, agentJson: async (file) => { converted += 1; return inner(file); } });
  assert.equal(converted, 1);
});

test("kickstart leaves a running instance alone; restart passes -k", async () => {
  const { deps, launchctlCalls } = agents([DAEMON]);
  const service = await findDaemonServiceManager(deps);
  launchctlCalls.length = 0;
  await kickstartDaemonService(service, {}, deps);
  await kickstartDaemonService(service, { restart: true }, deps);
  assert.deepEqual(launchctlCalls, [
    ["kickstart", "gui/501/com.opencoven.coven-daemon"],
    ["kickstart", "-k", "gui/501/com.opencoven.coven-daemon"],
  ]);
});

test("the job's own state is read, not a nested endpoint's", async () => {
  const running = agents([DAEMON]);
  assert.equal(await daemonServiceRunning(await findDaemonServiceManager(running.deps), running.deps), true);
  // The crash loop observed in #5730: launchd keeps rescheduling a job whose
  // instance exits on the serve lock another daemon holds.
  const looping = agents([{ ...DAEMON, state: "spawn scheduled" }]);
  assert.equal(await daemonServiceRunning(await findDaemonServiceManager(looping.deps), looping.deps), false);
});

test("a conflict is a loaded daemon service that is not running", async () => {
  assert.deepEqual(
    await daemonServiceConflict(agents([{ ...DAEMON, state: "spawn scheduled" }]).deps),
    { label: "com.opencoven.coven-daemon" },
  );
  assert.equal(await daemonServiceConflict(agents([DAEMON]).deps), null, "the service's own daemon is serving");
  assert.equal(await daemonServiceConflict(agents([]).deps), null, "no service, nothing to conflict with");
});

test("a daemon agent installed in /Library/LaunchAgents is found too", async () => {
  const { deps } = agents([{ ...DAEMON, dir: "/Library/LaunchAgents" }]);
  assert.equal((await findDaemonServiceManager(deps))?.label, "com.opencoven.coven-daemon");
});

test("a job's home and socket follow the daemon's own defaults", () => {
  assert.deepEqual(serviceDaemonTarget(DAEMON.json, "/Users/me"), {
    covenHome: "/Users/me/.coven",
    socket: "/Users/me/.coven/coven.sock",
  });
  assert.deepEqual(
    serviceDaemonTarget({ ...DAEMON.json, EnvironmentVariables: { COVEN_HOME: "/srv/coven" } }, "/Users/me"),
    { covenHome: "/srv/coven", socket: "/srv/coven/coven.sock" },
  );
  assert.equal(
    serviceDaemonTarget({ ...DAEMON.json, EnvironmentVariables: { COVEN_SOCKET: "/tmp/c.sock" } }, "/Users/me").socket,
    "/tmp/c.sock",
  );
  assert.equal(
    serviceDaemonTarget({ ...DAEMON.json, ProgramArguments: [...DAEMON.json.ProgramArguments, "--socket", "/tmp/arg.sock"] }, "/Users/me").socket,
    "/tmp/arg.sock",
    "--socket wins over the environment",
  );
});

test("a job serving another Coven home or socket does not own Cave's daemon", async () => {
  const expected = { covenHome: "/Users/me/.coven", socket: "/Users/me/.coven/coven.sock" };
  const other = { ...DAEMON, json: { ...DAEMON.json, EnvironmentVariables: { COVEN_HOME: "/Users/me/.coven-work" } } };
  assert.equal(await findDaemonServiceManager({ ...agents([other]).deps, expected }), null, "another home");
  const otherSocket = { ...DAEMON, json: { ...DAEMON.json, EnvironmentVariables: { COVEN_SOCKET: "/tmp/other.sock" } } };
  assert.equal(await findDaemonServiceManager({ ...agents([otherSocket]).deps, expected }), null, "another socket");
  assert.equal((await findDaemonServiceManager({ ...agents([DAEMON]).deps, expected }))?.label, DAEMON.json.Label, "the default home matches");
  assert.equal(
    await findDaemonServiceManager({ ...agents([DAEMON]).deps, expected: { covenHome: "/srv/coven", socket: "/srv/coven/coven.sock" } }),
    null,
    "Cave pointed at another COVEN_HOME does not adopt the default-home job",
  );
});
