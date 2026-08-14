// @ts-nocheck
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";

// A conversation's persisted harness is the resume contract. This exercises
// the real route after the familiar has subsequently been rebound to Claude:
// it must continue through OpenClaw rather than silently changing runtime.
const home = await mkdtemp(path.join(homedir(), "cave-openclaw-resume-"));
const bin = path.join(home, "bin");
const workspace = path.join(home, "workspace");
const calls = path.join(home, "openclaw-calls.jsonl");
const attachmentRoot = path.join(home, "blocked-chat-attachments");
const familiarWorkspaces = path.join(home, "workspaces", "familiars");
const wrenWorkspace = path.join(familiarWorkspaces, "wren");
const caseAliasWorkspace = path.join(familiarWorkspaces, "WREN");
const unavailableHarness = "__wardsunder_dispatch_unavailable__";
const pixelBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const blockedImage = {
  name: "blocked.png",
  type: "image/png",
  mimeType: "image/png",
  size: Buffer.from(pixelBase64, "base64").byteLength,
  dataUrl: `data:image/png;base64,${pixelBase64}`,
};
const daemonSocket = process.platform === "win32"
  ? `\\\\.\\pipe\\cave-openclaw-resume-${process.pid}-${path.basename(home)}`
  : path.join(home, "coven.sock");
const daemonOnlySessionId = "openclaw-daemon-only-resume";
await mkdir(bin, { recursive: true });
await mkdir(workspace, { recursive: true });
await mkdir(wrenWorkspace, { recursive: true });
if (process.platform !== "win32") await symlink("wren", caseAliasWorkspace, "dir");
await writeFile(path.join(home, "familiars.toml"), "[[familiar]]\nid = \"wren\"\nopenclaw_agent = \"wren\"\n");

const previousHome = process.env.COVEN_HOME;
const previousCaveHome = process.env.COVEN_CAVE_HOME;
const previousOpenClawBin = process.env.OPENCLAW_BIN;
const previousCallLog = process.env.OPENCLAW_TEST_CALLS;
const previousCovenSocket = process.env.COVEN_SOCKET;
const previousAttachmentRoot = process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR;
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.OPENCLAW_TEST_CALLS = calls;
process.env.COVEN_SOCKET = daemonSocket;
process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR = attachmentRoot;

let daemonSessionRequests = 0;
const daemon = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/api/v1/sessions") {
    daemonSessionRequests++;
    res.end(JSON.stringify([{
      id: daemonOnlySessionId,
      title: "Established daemon thread",
      project_root: workspace,
    }]));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});
await new Promise((resolve, reject) => {
  daemon.once("error", reject);
  daemon.listen(daemonSocket, () => {
    daemon.off("error", reject);
    resolve();
  });
});

const shimScript = path.join(bin, "openclaw.js");
await writeFile(shimScript, [
  "const { appendFileSync } = require('node:fs');",
  "appendFileSync(process.env.OPENCLAW_TEST_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');",
  "if (process.argv[2] === 'agent') {",
  "  process.stdout.write(JSON.stringify({ result: { payloads: [{ text: 'resumed through OpenClaw' }] } }) + '\\n');",
  "  process.exit(0);",
  "}",
  "process.exit(1);",
].join("\n"), { mode: 0o755 });

if (process.platform === "win32") {
  const shimBatch = path.join(bin, "openclaw.cmd");
  await writeFile(shimBatch, '"%~dp0\\openclaw.js" %*\r\n');
  process.env.OPENCLAW_BIN = shimBatch;
} else {
  const shimExecutable = path.join(bin, "openclaw");
  await writeFile(shimExecutable, `#!/usr/bin/env node\n${await readFile(shimScript, "utf8")}`, { mode: 0o755 });
  process.env.OPENCLAW_BIN = shimExecutable;
}

async function openClawInvocations() {
  try {
    return (await readFile(calls, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function directoryEntries(directory) {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function assertUntrustedHarness(response) {
  assert.equal(response.status, 403, await response.clone().text());
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "untrusted_chat_harness",
    error: "This familiar is not available for native Cave chat.",
  });
}

async function assertNotFound(response) {
  assert.equal(response.status, 404, await response.clone().text());
  assert.deepEqual(await response.json(), { ok: false, error: "not found" });
}

async function readSse(response) {
  assert.equal(response.status, 200, await response.clone().text());
  const events = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  return events;
}

try {
  const { loadConfig, loadState, saveConfig } = await import("@/lib/cave-config");
  const { loadConversation, saveConversation } = await import("@/lib/cave-conversations");
  const { chatSummaryTitle, defaultChatTitleForSession } = await import("@/lib/cave-chat-titles");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { POST } = await import("./route.ts");
  const {
    PATCH: PATCHModelState,
    handleModelStateGet,
  } = await import("../model-state/route.ts");

  const inventoryCalls = [];
  const modelStateDependencies = {
    listRuntimeModelInventory: async (runtime, familiarId) => {
      inventoryCalls.push({ runtime, familiarId });
      return {
        runtime,
        models: [],
        provenance: "runtime-managed",
        freshness: "runtime-managed",
        refreshState: "degraded",
        availability: "degraded",
        defaultOwner: "runtime",
        allowCustom: false,
        scope: {
          familiarId,
          runtime,
          provider: null,
          credentialScope: "runtime-managed",
          providerConfiguration: "runtime-managed",
        },
      };
    },
  };

  const sessionId = "openclaw-resume-contract";
  const now = new Date().toISOString();
  await saveConversation({
    sessionId,
    familiarId: "wren",
    harness: "openclaw",
    // OpenClaw owns model selection; an older conversation must therefore
    // retain the runtime-default sentinel rather than a Cave override.
    model: "",
    runtime: `local:${workspace}`,
    createdAt: now,
    updatedAt: now,
    turns: [{ id: "first-user", role: "user", text: "first", createdAt: now }],
    activeLeafId: "first-user",
  });
  // Simulate the familiar being edited after this conversation began.
  await saveConfig({ familiars: { wren: { harness: "claude", model: "" } } });
  const project = await createProject({ name: "OpenClaw resume fixture", root: workspace });
  await grantProjectToFamiliar({ familiarId: "wren", projectId: project.id, source: "human", access: "write" });

  const events = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "wren",
      sessionId,
      projectRoot: workspace,
      prompt: "continue this conversation",
    }),
  })));

  assert.deepEqual(
    events.filter((event) => event.kind === "assistant_chunk").map((event) => event.text),
    ["resumed through OpenClaw"],
  );
  assert.equal(events.find((event) => event.kind === "error"), undefined);
  const done = events.findLast((event) => event.kind === "done");
  assert.equal(done?.isError, false);
  assert.equal(done?.responseMetadata?.harness, "openclaw");
  assert.equal(done?.responseMetadata?.openclawAgentId, "wren");

  const invocations = await openClawInvocations();
  assert.equal(invocations.length, 1, "the resumed turn starts exactly one OpenClaw child");
  assert.deepEqual(invocations[0].slice(0, 3), ["agent", "--agent", "wren"]);
  assert.ok(invocations[0].includes(`cave-${sessionId}`), "the existing Cave session key is retained");

  const conversation = await loadConversation(sessionId);
  assert.equal(conversation?.harness, "openclaw", "resume never rewrites the stored harness");
  assert.equal(conversation?.turns.at(-1)?.responseMetadata?.harness, "openclaw");

  const trustedModelState = await handleModelStateGet(
    new Request(
      `http://localhost/api/chat/model-state?familiarId=wren&sessionId=${sessionId}`,
    ),
    modelStateDependencies,
  );
  assert.equal(trustedModelState.status, 200, await trustedModelState.clone().text());
  assert.equal(
    (await trustedModelState.json()).state.harness,
    "openclaw",
    "model state preserves the same trusted configured-to-persisted resume contract",
  );
  assert.deepEqual(
    inventoryCalls,
    [{ runtime: "openclaw", familiarId: "wren" }],
    "the injected aggregate inventory seam is exercised by a trusted request",
  );

  const trustedClaudeSessionId = "trusted-claude-model-state-contract";
  await saveConversation({
    sessionId: trustedClaudeSessionId,
    familiarId: "wren",
    harness: "claude",
    model: "anthropic/claude-sonnet-4-6",
    modelIntent: {
      model: "anthropic/claude-sonnet-4-6",
      source: "session",
      applicationState: "saved",
      reason: "Use Sonnet for this chat.",
    },
    runtime: `local:${workspace}`,
    createdAt: now,
    updatedAt: now,
    turns: [],
  });
  await saveConfig({ familiars: { wren: { harness: "claude", model: "" } } });
  const trustedClaudeModelState = await handleModelStateGet(
    new Request(
      `http://localhost/api/chat/model-state?familiarId=wren&sessionId=${trustedClaudeSessionId}`,
    ),
    modelStateDependencies,
  );
  assert.equal(
    trustedClaudeModelState.status,
    200,
    await trustedClaudeModelState.clone().text(),
  );
  const trustedClaudePayload = await trustedClaudeModelState.json();
  assert.deepEqual(
    trustedClaudePayload.controls.map(
      (control: { family: string; delivery: string }) => ({
        family: control.family,
        delivery: control.delivery,
      }),
    ),
    [{ family: "reasoning", delivery: "prompt-only" }],
    "a trusted Claude model exposes its audited prompt-only control",
  );
  assert.deepEqual(
    inventoryCalls,
    [
      { runtime: "openclaw", familiarId: "wren" },
      { runtime: "claude", familiarId: "wren" },
    ],
    "the positive trusted paths prove the aggregate discovery spy is wired",
  );

  // Installing the Wardsunder fail-closed binding disables every persisted
  // conversation for this familiar. A previously trusted OpenClaw transcript
  // must not revive a runtime, persist the rejected image, or alter the chat.
  const conversationBeforeConfiguredBlock = await loadConversation(sessionId);
  await saveConfig({
    familiars: { wren: { harness: unavailableHarness, model: "" } },
  });
  await assertUntrustedHarness(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "wren",
      sessionId,
      projectRoot: workspace,
      prompt: "this must stay blocked",
      attachments: [blockedImage],
    }),
  })));
  assert.equal(
    (await openClawInvocations()).length,
    1,
    "a trusted persisted harness cannot spawn through an untrusted configured binding",
  );
  assert.deepEqual(
    await loadConversation(sessionId),
    conversationBeforeConfiguredBlock,
    "a rejected configured binding cannot append or rewrite conversation state",
  );
  assert.deepEqual(
    await directoryEntries(attachmentRoot),
    [],
    "a rejected configured binding cannot persist attachment bytes",
  );

  // The inverse is also fail-closed: a trusted current binding cannot revive
  // an untrusted legacy/persisted conversation harness.
  const untrustedPersistedSessionId = "untrusted-persisted-resume-contract";
  await saveConversation({
    sessionId: untrustedPersistedSessionId,
    familiarId: "wren",
    harness: unavailableHarness,
    model: "",
    runtime: `local:${workspace}`,
    createdAt: now,
    updatedAt: now,
    turns: [{ id: "legacy-user", role: "user", text: "legacy", createdAt: now }],
    activeLeafId: "legacy-user",
  });
  const conversationBeforePersistedBlock = await loadConversation(untrustedPersistedSessionId);
  await saveConfig({ familiars: { wren: { harness: "openclaw", model: "" } } });
  await assertUntrustedHarness(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "wren",
      sessionId: untrustedPersistedSessionId,
      projectRoot: workspace,
      prompt: "legacy provenance must stay blocked",
      attachments: [blockedImage],
    }),
  })));
  assert.equal(
    (await openClawInvocations()).length,
    1,
    "an untrusted persisted harness cannot spawn through a trusted configured binding",
  );
  assert.deepEqual(
    await loadConversation(untrustedPersistedSessionId),
    conversationBeforePersistedBlock,
    "a rejected persisted harness cannot append or rewrite conversation state",
  );
  assert.deepEqual(
    await directoryEntries(attachmentRoot),
    [],
    "a rejected persisted harness cannot persist attachment bytes",
  );

  // Model-state uses the same trust boundary before inventory or controls. The
  // injected aggregate below makes the no-discovery assertion causal without
  // invoking a provider.
  await saveConfig({
    familiars: { wren: { harness: unavailableHarness, model: "" } },
  });
  await assertUntrustedHarness(await handleModelStateGet(
    new Request(`http://localhost/api/chat/model-state?familiarId=wren&sessionId=${sessionId}`),
    modelStateDependencies,
  ));

  await saveConfig({ familiars: { wren: { harness: "claude", model: "" } } });
  await assertUntrustedHarness(await handleModelStateGet(
    new Request(
      `http://localhost/api/chat/model-state?familiarId=wren&sessionId=${untrustedPersistedSessionId}`,
    ),
    modelStateDependencies,
  ));
  assert.equal(
    inventoryCalls.length,
    2,
    "neither untrusted harness direction reaches aggregate model discovery",
  );

  if (process.platform !== "win32") {
    assert.equal(
      await realpath(caseAliasWorkspace),
      await realpath(wrenWorkspace),
      "the Linux fixture reproduces a case-variant workspace alias to wren",
    );
    // The exact wren binding is fail-closed while the global default remains a
    // trusted executable harness. Before the identity gate, requesting WREN
    // missed the sentinel and the hidden origin adopted this symlinked
    // workspace without project authorization.
    await saveConfig({
      defaults: { harness: "openclaw", model: "" },
      familiars: { wren: { harness: unavailableHarness, model: "" } },
    });
    const configBeforeAliasAttempts = await loadConfig();
    const conversationsDirectory = path.join(home, "cave", "conversations");
    const conversationsBeforeAliasAttempts = await directoryEntries(conversationsDirectory);
    const invocationsBeforeAliasAttempts = (await openClawInvocations()).length;
    const inventoryBeforeAliasAttempts = inventoryCalls.length;

    await assertNotFound(await POST(new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familiarId: "WREN",
        sessionId,
        projectRoot: workspace,
        prompt: "ownership remains opaque",
        attachments: [blockedImage],
      }),
    })));
    await assertNotFound(await handleModelStateGet(
      new Request(
        `http://localhost/api/chat/model-state?familiarId=WREN&sessionId=${sessionId}`,
      ),
      modelStateDependencies,
    ));
    await assertNotFound(await PATCHModelState(new Request(
      "http://localhost/api/chat/model-state",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiarId: "WREN",
          sessionId,
          model: "",
          scope: "session",
        }),
      },
    )));

    for (const origin of ["canvas", "enhance", "journal"]) {
      await assertUntrustedHarness(await POST(new Request("http://localhost/api/chat/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiarId: "WREN",
          prompt: `blocked ${origin} case alias`,
          origin,
          attachments: [blockedImage],
        }),
      })));
    }

    await assertUntrustedHarness(await handleModelStateGet(
      new Request("http://localhost/api/chat/model-state?familiarId=WREN"),
      modelStateDependencies,
    ));
    await assertUntrustedHarness(await PATCHModelState(new Request(
      "http://localhost/api/chat/model-state",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiarId: "WREN",
          model: "",
          scope: "familiar-default",
        }),
      },
    )));

    await assertUntrustedHarness(await POST(new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familiarId: "unknown-familiar",
        prompt: "unknown ids cannot inherit the trusted default",
        origin: "canvas",
        attachments: [blockedImage],
      }),
    })));
    await assertUntrustedHarness(await handleModelStateGet(
      new Request("http://localhost/api/chat/model-state?familiarId=unknown-familiar"),
      modelStateDependencies,
    ));
    await assertUntrustedHarness(await PATCHModelState(new Request(
      "http://localhost/api/chat/model-state",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiarId: "unknown-familiar",
          model: "",
          scope: "familiar-default",
        }),
      },
    )));

    const familiarsManifest = path.join(home, "familiars.toml");
    const originalManifest = await readFile(familiarsManifest, "utf8");
    const collidingManifest = [
      "[[familiar]]",
      'id = "wren"',
      'openclaw_agent = "wren"',
      "",
      "[[familiar]]",
      'id = "WREN"',
      'openclaw_agent = "WREN"',
      "",
    ].join("\n");
    await saveConfig({ familiars: { wren: { harness: "openclaw", model: "legacy" } } });
    await writeFile(familiarsManifest, collidingManifest);
    const configBeforeCollisionAttempts = await loadConfig();
    await assertUntrustedHarness(await POST(new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familiarId: "wren",
        prompt: "case-colliding identities fail closed",
        origin: "canvas",
        attachments: [blockedImage],
      }),
    })));
    await assertUntrustedHarness(await handleModelStateGet(
      new Request("http://localhost/api/chat/model-state?familiarId=wren"),
      modelStateDependencies,
    ));
    await assertUntrustedHarness(await PATCHModelState(new Request(
      "http://localhost/api/chat/model-state",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiarId: "wren",
          model: "",
          scope: "familiar-default",
        }),
      },
    )));
    assert.equal(
      await readFile(familiarsManifest, "utf8"),
      collidingManifest,
      "rejected case-collision requests cannot rewrite the identity manifest",
    );
    assert.deepEqual(
      await loadConfig(),
      configBeforeCollisionAttempts,
      "rejected case-collision requests cannot mutate Cave config",
    );
    await writeFile(familiarsManifest, originalManifest);
    await saveConfig({
      familiars: { wren: { harness: unavailableHarness, model: "" } },
    });

    assert.equal(
      (await openClawInvocations()).length,
      invocationsBeforeAliasAttempts,
      "case-variant hidden generators cannot start a runtime child",
    );
    assert.equal(
      inventoryCalls.length,
      inventoryBeforeAliasAttempts,
      "case-variant model state cannot reach aggregate model discovery",
    );
    assert.deepEqual(
      await directoryEntries(attachmentRoot),
      [],
      "case-variant hidden generators cannot persist attachment bytes",
    );
    assert.deepEqual(
      await directoryEntries(conversationsDirectory),
      conversationsBeforeAliasAttempts,
      "case-variant hidden generators cannot create or rewrite conversations",
    );
    assert.deepEqual(
      await loadConfig(),
      configBeforeAliasAttempts,
      "case-variant send and model-state PATCH cannot mutate config",
    );
  }

  // A resumed send to an existing Cave-persisted OpenClaw session must not
  // claim or reset auto title ownership — it is a follow-up, not a first turn.
  const followUpState = await loadState();
  assert.equal(
    followUpState.sessionTitleAuto[sessionId],
    undefined,
    "OpenClaw follow-up to a Cave session does not claim auto title ownership",
  );

  // A daemon-originated session has no Cave conversation file yet. The body
  // session id and daemon row still make this a follow-up, not a first turn.
  await saveConfig({ familiars: { wren: { harness: "openclaw", model: "" } } });
  assert.equal(await loadConversation(daemonOnlySessionId), null);
  const daemonResumePrompt = "continue the established daemon thread";
  const daemonResumeEvents = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "wren",
      sessionId: daemonOnlySessionId,
      startNewConversation: true,
      prompt: daemonResumePrompt,
    }),
  })));
  assert.ok(daemonSessionRequests > 0, "daemon-only resume resolves its authoritative daemon session");
  assert.equal(daemonResumeEvents.findLast((event) => event.kind === "done")?.isError, false);
  const daemonResumeConversation = await loadConversation(daemonOnlySessionId);
  assert.equal(
    daemonResumeConversation?.title,
    defaultChatTitleForSession(daemonOnlySessionId),
    "a follow-up prompt does not become the title of a daemon-owned session",
  );
  let state = await loadState();
  assert.equal(
    state.sessionTitleAuto[daemonOnlySessionId],
    undefined,
    "daemon-only resume does not claim automatic title ownership",
  );

  // A genuinely new OpenClaw request has no submitted session id and therefore
  // owns first-exchange title initialization.
  const newPrompt = "design retry queues";
  const newEvents = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "wren",
      projectRoot: workspace,
      prompt: newPrompt,
    }),
  })));
  const newSessionId = newEvents.find((event) => event.kind === "session")?.sessionId;
  assert.ok(newSessionId, "new OpenClaw chat announces its Cave-owned session id");
  state = await loadState();
  assert.equal(
    state.sessionTitleAuto[newSessionId],
    chatSummaryTitle({ userText: newPrompt }),
    "true new OpenClaw chat initializes automatic title ownership",
  );
} finally {
  if (previousHome === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousHome;
  if (previousCaveHome === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = previousCaveHome;
  if (previousOpenClawBin === undefined) delete process.env.OPENCLAW_BIN;
  else process.env.OPENCLAW_BIN = previousOpenClawBin;
  if (previousCallLog === undefined) delete process.env.OPENCLAW_TEST_CALLS;
  else process.env.OPENCLAW_TEST_CALLS = previousCallLog;
  if (previousCovenSocket === undefined) delete process.env.COVEN_SOCKET;
  else process.env.COVEN_SOCKET = previousCovenSocket;
  if (previousAttachmentRoot === undefined) delete process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR;
  else process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR = previousAttachmentRoot;
  await new Promise((resolve, reject) => daemon.close((error) => error ? reject(error) : resolve()));
  await rm(home, { recursive: true, force: true });
}
