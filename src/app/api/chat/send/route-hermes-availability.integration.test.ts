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
const bin = path.join(home, "bin");
const familiarWorkspace = path.join(home, "familiars", "ember");
await mkdir(bin, { recursive: true });
await mkdir(familiarWorkspace, { recursive: true });

const previousHome = process.env.COVEN_HOME;
const previousCaveHome = process.env.COVEN_CAVE_HOME;
const previousPath = process.env.PATH;
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.PATH = bin;

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
    await writeFile(path.join(bin, brokenName), "not an executable\n", { mode: 0o644 });
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

  // A spawn ENOENT can also come from a workspace deleted after the
  // executable preflight. Hermes still exists in that race, so it must not be
  // reported as missing. The help probe runs before spawn and makes this
  // ordering deterministic without platform-specific spawn mocks.
  if (process.platform !== "win32") {
    const executable = path.join(bin, "hermes");
    await unlink(executable);
    await writeFile(
      executable,
      `#!/bin/sh
if [ "$1" = "chat" ] && [ "$2" = "--help" ]; then
  /bin/rm -rf "$COVEN_HOME/familiars/ember"
fi
exit 0
`,
      { mode: 0o755 },
    );
    const response = await POST(new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiarId: "ember", prompt: "vanishing workspace", projectRoot: familiarWorkspace }),
    }));
    const { body, events } = await readSse(response);
    const error = events.find((event) => event.kind === "error");
    assert.equal(error?.code, "runtime_unlaunchable", "a surviving Hermes executable is not reported missing when its cwd vanishes");
    assert.doesNotMatch(error?.message ?? "", /not found on PATH/i);
    assertNoFabricatedAssistantResponse(body, events);
    await mkdir(familiarWorkspace, { recursive: true });
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
} finally {
  if (previousHome === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousHome;
  if (previousCaveHome === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = previousCaveHome;
  if (previousPath === undefined) delete process.env.PATH;
  else process.env.PATH = previousPath;
  await rm(home, { recursive: true, force: true });
}

console.log("route-hermes-availability.integration.test.ts: ok");
