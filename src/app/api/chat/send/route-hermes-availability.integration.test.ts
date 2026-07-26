// @ts-nocheck
import assert from "node:assert/strict";
import { copyFile, link, mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Hermes-specific launch coverage for #3860. The resolver must stop an absent
// direct CLI before any model command starts, then the post-preflight fallback
// must still suppress fabricated assistant/auth copy if the file disappears or
// fails when spawn reaches it.
const home = await mkdtemp(path.join(homedir(), "cave-hermes-availability-"));
const familiarWorkspace = path.join(home, "familiars", "ember");
const bin = path.join(familiarWorkspace, "bin");
await mkdir(familiarWorkspace, { recursive: true });
await mkdir(bin, { recursive: true });

const previousHome = process.env.COVEN_HOME;
const previousCaveHome = process.env.COVEN_CAVE_HOME;
const previousPath = process.env.PATH;
const previousPathCase = process.env.Path;
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
// A relative PATH entry must resolve from the familiar workspace used by the
// preflight, model probe, and direct child — not from the test/server cwd.
if (process.platform === "win32") delete process.env.Path;
process.env.PATH = "bin";

async function readSse(response) {
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.text();
  return {
    body,
    events: body
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice("data: ".length))),
  };
}

function assertNoFabricatedAssistantResponse(body, events) {
  assert.doesNotMatch(body, /installed but not authenticated/i);
  assert.doesNotMatch(body, /produced no output/i);
  assert.ok(!events.some((event) => event.kind === "assistant_chunk"));
}

try {
  const { refreshCovenBin, refreshCovenSpawnEnv } = await import("@/lib/coven-bin");
  refreshCovenBin();
  refreshCovenSpawnEnv();
  const { saveConfig } = await import("@/lib/cave-config");
  const { loadConversation } = await import("@/lib/cave-conversations");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { POST } = await import("./route.ts");
  await saveConfig({ familiars: { ember: { harness: "hermes" } } });
  const project = await createProject({ name: "Hermes availability fixture", root: familiarWorkspace });
  await grantProjectToFamiliar({ familiarId: "ember", projectId: project.id, source: "human", access: "write" });

  // Missing: no CLI capability/model invocation is possible, and no assistant
  // turn is invented to explain an executable that never launched.
  {
    const response = await POST(new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiarId: "ember", prompt: "hello", projectRoot: familiarWorkspace }),
    }));
    const { body, events } = await readSse(response);
    const error = events.find((event) => event.kind === "error");
    assert.equal(error?.code, "runtime_missing", "missing Hermes returns the shared preflight code");
    assert.match(error?.message ?? "", /Hermes CLI not found on PATH/);
    assertNoFabricatedAssistantResponse(body, events);
    const done = events.findLast((event) => event.kind === "done");
    assert.equal(done?.isError, true, "a missing Hermes launch completes as an error");
    if (done?.sessionId) {
      const conversation = await loadConversation(done.sessionId);
      assert.equal((conversation?.turns ?? []).filter((turn) => turn.role === "assistant").length, 0);
    }
  }

  // Race fallback: a real file passes stat-based preflight but cannot be
  // launched. The direct native command differs by platform, yet neither
  // failure may become a generic authentication/no-output assistant message.
  {
    const brokenName = process.platform === "win32" ? "hermes.exe" : "hermes";
    await writeFile(
      path.join(bin, brokenName),
      process.platform === "win32"
        ? "not an executable\n"
        : `#!${path.join(home, "missing-interpreter")}\nexit 0\n`,
      { mode: 0o755 },
    );
    const response = await POST(new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiarId: "ember", prompt: "hello again", projectRoot: familiarWorkspace }),
    }));
    const { body, events } = await readSse(response);
    const errors = events.filter((event) => event.kind === "error");
    const error = errors[0];
    assert.equal(errors.length, 1, "a failed Hermes spawn emits one terminal structured error");
    assert.equal(error?.code, "runtime_unlaunchable", "an existing Hermes file that cannot spawn is unlaunchable, not missing");
    assertNoFabricatedAssistantResponse(body, events);
    assert.ok(!body.includes(bin), "Hermes launch diagnostics do not expose the local executable path");
  }

  // A CLI that starts but exits with an auth/config-style failure is distinct
  // from a missing executable. Use Node as a portable native executable and
  // have its `chat` script write to stdout: failed Hermes output must not leak
  // as an assistant reply before the structured runtime error.
  {
    const executable = path.join(bin, process.platform === "win32" ? "hermes.exe" : "hermes");
    await unlink(executable);
    await writeFile(
      path.join(familiarWorkspace, "chat"),
      'process.stderr.write("session_id: failed-hermes-session\\n"); process.stdout.write("Hermes authentication failed\\n"); process.exit(1);\\n',
    );
    try {
      await link(process.execPath, executable);
    } catch {
      await copyFile(process.execPath, executable);
    }
    const response = await POST(new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiarId: "ember", prompt: "hello once more", projectRoot: familiarWorkspace }),
    }));
    const { body, events } = await readSse(response);
    const error = events.find((event) => event.kind === "error");
    assert.equal(error?.code, "runtime_process_failed", "a started Hermes failure has its own structured code");
    assert.match(error?.message ?? "", /Hermes exited with an error/);
    assertNoFabricatedAssistantResponse(body, events);
    assert.ok(!body.includes("Hermes authentication failed"), "failed Hermes stdout is never rendered as an assistant reply");
    assert.ok(!body.includes(bin), "started Hermes failure does not expose the local executable path");
    assert.ok(!events.some((event) => event.kind === "session"), "a failed Hermes process never announces a session");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      await loadConversation("failed-hermes-session"),
      null,
      "a failed Hermes process never persists its pre-error session stub",
    );
  }

  // A failed native resume is retried as a fresh Hermes chat. The first
  // process did start, but its stale-session exit must neither leak its stdout
  // nor become a terminal runtime-process failure that blocks the retry's
  // successful response from being persisted.
  {
    await writeFile(
      path.join(familiarWorkspace, "chat"),
      [
        'if (process.argv.includes("--resume")) {',
        '  process.stdout.write("stale Hermes output\\n");',
        '  process.stderr.write("session_id: stale-hermes-session\\nSession not found\\n");',
        '  process.exit(1);',
        '}',
        'process.stdout.write("fresh Hermes response\\n");',
      ].join("\n"),
    );
    const response = await POST(new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familiarId: "ember",
        prompt: "resume me",
        projectRoot: familiarWorkspace,
        sessionId: "missing-hermes-session",
      }),
    }));
    const { body, events } = await readSse(response);
    assert.ok(
      !events.some((event) => event.kind === "error" && event.code === "runtime_process_failed"),
      "a stale Hermes resume is retried instead of reported as a terminal process failure",
    );
    assert.match(body, /fresh Hermes response/);
    assert.doesNotMatch(body, /stale Hermes output/);
    assert.ok(
      !events.some((event) => event.kind === "session" && event.sessionId === "stale-hermes-session"),
      "the fresh retry never announces the stale session id from the failed process",
    );
    const conversation = await loadConversation("missing-hermes-session");
    assert.equal(
      conversation?.turns.at(-1)?.text.trim(),
      "fresh Hermes response",
      "the successful fresh retry persists instead of being suppressed by the stale attempt",
    );
  }
} finally {
  if (previousHome === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousHome;
  if (previousCaveHome === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = previousCaveHome;
  if (previousPath === undefined) delete process.env.PATH;
  else process.env.PATH = previousPath;
  if (previousPathCase === undefined) delete process.env.Path;
  else process.env.Path = previousPathCase;
  await rm(home, { recursive: true, force: true });
}

console.log("route-hermes-availability.integration.test.ts: ok");
