// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildSshCovenRunCommand,
  buildSshSpawnArgs,
  normalizeFamiliarRuntime,
} from "./familiar-runtime.ts";

assert.deepEqual(
  normalizeFamiliarRuntime(undefined),
  { kind: "local" },
  "Missing runtime config should preserve today's local familiar behavior",
);

assert.deepEqual(
  normalizeFamiliarRuntime({
    kind: "ssh",
    host: "devbox",
    cwd: "/home/val/cave work",
  }),
  {
    kind: "ssh",
    host: "devbox",
    cwd: "/home/val/cave work",
    command: "coven",
  },
  "SSH runtime config should fill the safe default remote command",
);

assert.equal(
  normalizeFamiliarRuntime({
    kind: "ssh",
    host: "bad;host",
    cwd: "/home/val/project",
  }).kind,
  "local",
  "Unsafe SSH host aliases should not be accepted as remote runtimes",
);

const remoteCommand = buildSshCovenRunCommand({
  runtime: {
    kind: "ssh",
    host: "devbox",
    cwd: "/home/val/project; touch hacked",
    command: "/opt/coven/bin/coven",
  },
  harness: "codex",
  familiarId: "remote-sage",
  prompt: "hello'; touch /tmp/hacked #",
  sessionId: "session-123",
});

assert.equal(
  remoteCommand,
  "cd -- '/home/val/project; touch hacked' && '/opt/coven/bin/coven' 'run' 'codex' '--stream-json' '--continue' 'session-123' '--familiar' 'remote-sage' '--' 'hello'\\''; touch /tmp/hacked #'",
  "Remote command construction must quote cwd, command, harness args, session id, familiar id, and prompt",
);

assert.deepEqual(
  buildSshSpawnArgs({
    runtime: {
      kind: "ssh",
      host: "devbox",
      cwd: "/home/val/project",
      command: "coven",
    },
    harness: "claude",
    familiarId: "remote_sage",
    prompt: "summon",
    sessionId: null,
  }),
  [
    "-T",
    "--",
    "devbox",
    "cd -- '/home/val/project' && 'coven' 'run' 'claude' '--stream-json' '--familiar' 'remote_sage' '--' 'summon'",
  ],
  "SSH spawn args should keep the host as its own argv entry and send one quoted remote command",
);

// Model parity: when a model is forwarded it must land BEFORE the `--` prompt
// separator (the prompt is a variadic positional that would otherwise swallow
// it), and stay quoted.
assert.equal(
  buildSshCovenRunCommand({
    runtime: { kind: "ssh", host: "devbox", cwd: "/home/val/project", command: "coven" },
    harness: "claude",
    familiarId: "remote_sage",
    prompt: "summon",
    sessionId: null,
    model: "anthropic/claude-opus-4-7",
  }),
  "cd -- '/home/val/project' && 'coven' 'run' 'claude' '--stream-json' '--model' 'anthropic/claude-opus-4-7' '--familiar' 'remote_sage' '--' 'summon'",
  "A forwarded model should be emitted as a quoted --model before the prompt separator",
);

// No model ⇒ no --model flag (today's behavior preserved).
assert.doesNotMatch(
  buildSshCovenRunCommand({
    runtime: { kind: "ssh", host: "devbox", cwd: "/home/val/project", command: "coven" },
    harness: "claude",
    familiarId: "remote_sage",
    prompt: "summon",
    sessionId: null,
  }),
  /--model/,
  "Omitting model must not introduce a --model flag",
);
