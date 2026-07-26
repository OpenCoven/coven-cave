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
    const error = events.find((event) => event.kind === "error");
    assert.ok(error, "a post-preflight Hermes launch failure is structured");
    assert.notEqual(error.code, "runtime_missing", "an existing Hermes file is not reclassified as absent after spawn");
    assertNoFabricatedAssistantResponse(body, events);
    assert.ok(!body.includes(bin), "Hermes launch diagnostics do not expose the local executable path");
  }

  // A CLI that starts but exits with an auth/config-style failure is distinct
  // from a missing executable. It must emit a structured error rather than the
  // generic successful-looking "produced no output" assistant fallback.
  {
    const executable = path.join(bin, process.platform === "win32" ? "hermes.exe" : "hermes");
    await unlink(executable);
    const failingExecutable = process.platform === "win32"
      ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "where.exe")
      : "/bin/false";
    try {
      await link(failingExecutable, executable);
    } catch {
      await copyFile(failingExecutable, executable);
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
    assert.ok(!body.includes(bin), "started Hermes failure does not expose the local executable path");
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
