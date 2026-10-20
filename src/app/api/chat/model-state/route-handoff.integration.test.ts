// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Exercise the real request and persistence boundaries without touching the
// operator's config, conversations, credentials, or native sessions.
const home = await mkdtemp(path.join(tmpdir(), "cave-model-handoff-"));
const previous = { COVEN_HOME: process.env.COVEN_HOME, COVEN_CAVE_HOME: process.env.COVEN_CAVE_HOME };
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");

try {
  const { saveConfig, recordSessionFamiliar } = await import("@/lib/cave-config");
  const { saveConversation, loadConversation } = await import("@/lib/cave-conversations");
  const { PATCH } = await import("./route.ts");
  await saveConfig({ familiars: { opal: { harness: "codex", model: "" } } });
  const patch = (body) => PATCH(new Request("http://localhost/api/chat/model-state", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  const handoff = (sessionId, extra = {}) => patch({
    familiarId: "opal", sessionId, scope: "runtime-handoff", runtime: "codex", ...extra,
  });
  const seed = async (sessionId, familiarId = "opal") => {
    const now = new Date().toISOString();
    await saveConversation({ sessionId, familiarId, harness: "claude", harnessSessionId: "old-native-session",
      modelIntent: { model: "claude-opus-4-6", source: "session", applicationState: "saved" },
      createdAt: now, updatedAt: now, turns: [],
    });
  };

  await test("composer handoff without a model persists the target runtime and clears the old model", async () => {
    await seed("persisted-chat");
    const response = await handoff("persisted-chat");
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const { state } = await response.json();
    assert.equal(state.harness, "codex");
    const saved = await loadConversation("persisted-chat");
    assert.equal(saved.pendingRuntimeHandoff.toHarness, "codex");
    assert.equal(saved.pendingRuntimeHandoff.fromHarness, "claude");
    assert.equal(saved.modelIntent.model, "");
  });

  await test("daemon-only handoff creates a fresh-session boundary", async () => {
    await recordSessionFamiliar("daemon-chat", "opal");
    const response = await handoff("daemon-chat", { model: "" });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const saved = await loadConversation("daemon-chat");
    assert.equal(saved.familiarId, "opal");
    assert.equal(saved.pendingRuntimeHandoff.toHarness, "codex");
    assert.equal(saved.modelIntent.model, "");
  });

  await test("handoffs cannot claim another familiar's persisted or daemon-only chat", async () => {
    await seed("foreign-chat", "ruby");
    await recordSessionFamiliar("foreign-daemon", "ruby");
    for (const sessionId of ["foreign-chat", "foreign-daemon"]) {
      assert.equal((await handoff(sessionId, { model: "" })).status, 404);
    }
    assert.equal((await loadConversation("foreign-chat")).pendingRuntimeHandoff, undefined);
    assert.equal(await loadConversation("foreign-daemon"), null);
  });

  await test("model writes still require a model and an existing owned session", async () => {
    for (const scope of ["session", "familiar-default"]) {
      assert.equal((await patch({ familiarId: "opal", sessionId: "persisted-chat", scope })).status, 400);
    }
    assert.equal((await patch({ familiarId: "opal", sessionId: "missing-chat", scope: "session", model: "" })).status, 404);
  });

  await test("handoffs still require a session and the configured target runtime", async () => {
    assert.equal((await handoff(undefined, { model: "" })).status, 400);
    assert.equal((await handoff("persisted-chat", { model: "", runtime: "claude" })).status, 409);
    assert.equal((await handoff("persisted-chat", { model: "", runtime: "invalid" })).status, 400);
  });
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await rm(home, { recursive: true, force: true });
}
