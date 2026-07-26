// @ts-nocheck
import assert from "node:assert/strict";
import {
  LOCAL_HOST_ID,
  chatHostOptions,
  parseConversationRuntime,
  resolveRequestedRuntime,
  sshHostRegistry,
} from "./chat-hosts.ts";

// ── Registry merge: registered hosts win, familiar bindings fill in, junk drops ──
const registry = sshHostRegistry({
  remoteHosts: [
    { host: "vm-1", cwd: "/srv/work" },
    { host: "ubuntu-root", cwd: "/root", command: "/opt/coven/bin/coven" },
    { host: "bad host!", cwd: "/tmp" }, // unsafe host chars → dropped
    { host: "vm-1", cwd: "/elsewhere" }, // duplicate → first wins
    null,
  ],
  familiarRuntimes: [
    { kind: "ssh", host: "mac-studio.local", cwd: "/Users/val" },
    { kind: "ssh", host: "vm-1", cwd: "/home/other" }, // already registered → dedupe
    { kind: "local" },
    undefined,
  ],
});
assert.deepEqual(
  registry.map((r) => r.host),
  ["vm-1", "ubuntu-root", "mac-studio.local"],
  "registered hosts first, familiar-bound hosts appended, invalid/duplicate dropped",
);
assert.equal(registry[0].cwd, "/srv/work", "the registered entry's cwd wins over a familiar duplicate");
assert.equal(registry[1].command, "/opt/coven/bin/coven", "registry carries a custom remote command");
assert.equal(registry[2].command, "coven", "command defaults to coven");

// ── Picker options: local always first and online ────────────────────────────
const options = chatHostOptions({ localLabel: "Vals-MacBook", registry });
assert.equal(options[0].id, LOCAL_HOST_ID);
assert.equal(options[0].online, true, "the local machine is always online");
assert.deepEqual(
  options.slice(1).map((o) => o.id),
  ["vm-1", "ubuntu-root", "mac-studio.local"],
);
assert.equal(options[1].online, null, "ssh hosts are unprobed until the route checks them");

// ── Conversation runtime parsing ─────────────────────────────────────────────
assert.deepEqual(parseConversationRuntime("local:/Users/val/repo"), { kind: "local", cwd: "/Users/val/repo" });
assert.deepEqual(parseConversationRuntime("ssh:vm-1:/srv/work"), { kind: "ssh", host: "vm-1", cwd: "/srv/work" });
assert.deepEqual(parseConversationRuntime("ssh:vm-1"), { kind: "ssh", host: "vm-1" });
assert.equal(parseConversationRuntime("garbage"), null);
assert.equal(parseConversationRuntime(null), null);

// ── Requested-runtime resolution (fail closed) ──────────────────────────────
const resolve = (requestedHost, conversationRuntime = null, currentRuntime = { kind: "local" }) =>
  resolveRequestedRuntime({ requestedHost, conversationRuntime, registry, currentRuntime });

assert.deepEqual(resolve("local"), { ok: true, runtime: { kind: "local" } }, "'local' keeps a local-bound familiar on the local machine");
{
  const rejected = resolve("local", null, { kind: "ssh", host: "vm-1", cwd: "/srv/work", command: "coven" });
  assert.equal(rejected.ok, false, "'local' cannot downgrade an ssh-bound familiar to local execution");
  assert.match(rejected.error, /local runtime is not allowed/);
}

assert.deepEqual(
  resolve("vm-1"),
  { ok: true, runtime: { kind: "ssh", host: "vm-1", cwd: "/srv/work", command: "coven" } },
  "a registered host resolves to its registry runtime (command from registry, never the client)",
);
{
  const rejected = resolve("evil.example.com");
  assert.equal(rejected.ok, false, "an unregistered host is rejected, not improvised");
  assert.match(rejected.error, /not registered/);
}

// No request → a conversation recorded on a registered ssh host stays pinned there…
assert.deepEqual(
  resolve(null, "ssh:vm-1:/srv/elsewhere"),
  { ok: true, runtime: { kind: "ssh", host: "vm-1", cwd: "/srv/elsewhere", command: "coven" } },
  "resume re-pins the conversation's host AND its recorded cwd",
);
// …but a host that has since been unregistered FAILS CLOSED: silently falling
// back to the (local) binding lost the remote context and surprise-relocated
// execution (cave-4zdp). The error names the host and the re-pick path.
{
  const gone = resolve(null, "ssh:gone-host:/srv");
  assert.equal(gone.ok, false, "recorded-host-gone refuses, not silently local");
  assert.match(gone.error, /gone-host/, "names the missing host");
  assert.match(gone.error, /no longer registered/, "explains why");
  assert.match(gone.error, /host chip/i, "points at the re-pick affordance");
}
assert.deepEqual(resolve(null, "local:/Users/val/repo"), { ok: true, runtime: null }, "local conversations defer to the binding");
assert.deepEqual(resolve(null, null), { ok: true, runtime: null });

console.log("chat-hosts.test.ts: ok");
