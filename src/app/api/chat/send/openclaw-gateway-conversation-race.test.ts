import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";

const testRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testRoot, { recursive: true });
const home = await mkdtemp(path.join(testRoot, "openclaw-gateway-race-"));
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.COVEN_HOME = path.join(home, "coven");

const {
  createConversationStub,
  deleteConversation,
  loadConversation,
  saveConversation,
  withConversationLock,
} = await import("@/lib/cave-conversations");
const { appendVoiceOriginTurn } = await import("@/lib/voice/append-voice-turn");
const { DELETE, PATCH } = await import("../conversation/[id]/route.ts");
const {
  persistGatewayTranscript,
  settleGatewayInitialStub,
} = await import("./gateway-transcript-persistence.ts");

after(async () => {
  await rm(home, { recursive: true, force: true });
});

function seed(id: string) {
  const now = "2026-08-11T00:00:00.000Z";
  return saveConversation({
    sessionId: id,
    familiarId: "wren",
    harness: "openclaw",
    runtime: `local:${home}`,
    createdAt: now,
    updatedAt: now,
    turns: [{ id: "seed", role: "user", text: "seed", createdAt: now, parentId: null }],
    activeLeafId: "seed",
  });
}

function lockBarrier(id: string) {
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = withConversationLock(id, async () => {
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  return { ready, held, release: () => release() };
}

function emptyGatewayConversation(id: string) {
  const now = "2026-08-11T00:00:00.000Z";
  return {
    sessionId: id,
    familiarId: "wren",
    harness: "openclaw",
    runtime: `local:${home}`,
    createdAt: now,
    updatedAt: now,
    turns: [],
  };
}

async function gatewayCompletion(
  id: string,
  initialStubState: Awaited<ReturnType<typeof settleGatewayInitialStub>> = {
    kind: "already-existed",
  },
): Promise<boolean> {
  return persistGatewayTranscript({
    sessionId: id,
    initialStubState,
    deps: { loadConversation, saveConversation, withConversationLock },
    createAfterInitialStubFailure: () => emptyGatewayConversation(id),
    complete: (conv) => {
      conv.turns.push(
        {
          id: "gateway-user",
          role: "user",
          text: "Gateway prompt",
          createdAt: "2026-08-11T00:00:01.000Z",
          parentId: conv.activeLeafId ?? null,
        },
        {
          id: "gateway-assistant",
          role: "assistant",
          text: "Gateway reply",
          createdAt: "2026-08-11T00:00:02.000Z",
          parentId: "gateway-user",
        },
      );
      conv.activeLeafId = "gateway-assistant";
      return true;
    },
  });
}

test("Gateway persists a completed transcript after an initial stub write failure recovers", async () => {
  const id = "gateway-stub-write-recovery";
  const initialStubState = await settleGatewayInitialStub(
    Promise.reject(new Error("transient conversation-store failure")),
    () => undefined,
  );

  assert.equal(initialStubState.kind, "failed-before-exists");
  assert.equal(await gatewayCompletion(id, initialStubState), true);
  assert.deepEqual(
    (await loadConversation(id))?.turns.map((turn) => turn.text),
    ["Gateway prompt", "Gateway reply"],
  );
});

test("Gateway normally updates an existing conversation", async () => {
  const id = "gateway-normal-update";
  await seed(id);

  assert.equal(await gatewayCompletion(id), true);
  assert.deepEqual(
    (await loadConversation(id))?.turns.map((turn) => turn.text),
    ["seed", "Gateway prompt", "Gateway reply"],
  );
});

test("Gateway surfaces a final transcript persistence failure", async () => {
  const id = "gateway-final-write-failure";
  const initialStubState = await settleGatewayInitialStub(
    Promise.reject(new Error("initial write failed")),
    () => undefined,
  );

  await assert.rejects(
    persistGatewayTranscript({
      sessionId: id,
      initialStubState,
      deps: {
        loadConversation,
        saveConversation: async () => {
          throw new Error("final conversation-store failure");
        },
        withConversationLock,
      },
      createAfterInitialStubFailure: () => emptyGatewayConversation(id),
      complete: (conv) => {
        conv.turns.push({
          id: "gateway-user",
          role: "user",
          text: "Gateway prompt",
          createdAt: "2026-08-11T00:00:01.000Z",
          parentId: null,
        });
      },
    }),
    /final conversation-store failure/,
  );
  assert.equal(await loadConversation(id), null);
});

test("Gateway completion serializes with voice append and client PATCH without losing either write", async () => {
  const id = "gateway-patch-voice-race";
  await seed(id);
  const barrier = lockBarrier(id);
  await barrier.ready;

  const gateway = gatewayCompletion(id);
  const voice = appendVoiceOriginTurn(id, {
    callId: "call-1",
    role: "user",
    text: "voice turn",
    createdAt: "2026-08-11T00:00:03.000Z",
  });
  const patch = PATCH(
    new Request(`http://test/api/chat/conversation/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        modelIntent: { model: "", source: "session" },
      }),
    }),
    { params: Promise.resolve({ id }) },
  );

  barrier.release();
  await barrier.held;
  assert.equal(await gateway, true);
  await voice;
  assert.equal((await patch).status, 200);

  const final = await loadConversation(id);
  assert.ok(final);
  assert.deepEqual(
    final.turns.map((turn) => turn.text),
    ["seed", "Gateway prompt", "Gateway reply", "voice turn"],
  );
  assert.equal(final.modelIntent?.model, "");
});

test("client DELETE winning the lock prevents a late Gateway completion from resurrecting the file", async () => {
  const id = "gateway-delete-race";
  const stubCreated = await createConversationStub({
    sessionId: id,
    familiarId: "wren",
    harness: "openclaw",
    runtime: `local:${home}`,
    userTurn: { id: "stub-user", text: "Gateway prompt" },
  });
  const initialStubState = await settleGatewayInitialStub(Promise.resolve(stubCreated), () => undefined);
  assert.equal(initialStubState.kind, "created");
  const barrier = lockBarrier(id);
  await barrier.ready;

  let paramsConsumed!: () => void;
  const consumed = new Promise<void>((resolve) => {
    paramsConsumed = resolve;
  });
  const deletion = DELETE(
    new Request(`http://test/api/chat/conversation/${id}`, { method: "DELETE" }),
    {
      params: {
        then(resolve: (value: { id: string }) => void) {
          paramsConsumed();
          resolve({ id });
        },
      } as unknown as Promise<{ id: string }>,
    },
  );
  await consumed;
  await Promise.resolve();
  const gateway = gatewayCompletion(id, initialStubState);

  barrier.release();
  await barrier.held;
  assert.equal((await deletion).status, 200);
  await assert.rejects(gateway, /conversation deleted before Gateway transcript save/);
  assert.equal(await loadConversation(id), null);
  assert.equal(await deleteConversation(id), false);
});

test("production OpenClaw Gateway persistence tracks stub failure separately from deletion", async () => {
  const routeSource = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  const helperSource = await readFile(new URL("./gateway-transcript-persistence.ts", import.meta.url), "utf8");
  const start = routeSource.indexOf('if (gatewayDispatch.kind === "accepted")');
  const end = routeSource.indexOf("const openclawLaunch = openClawLaunchCommand()", start);
  assert.ok(start >= 0 && end > start);
  const branch = routeSource.slice(start, end);
  assert.match(branch, /const initialStubState = settleGatewayInitialStub\(\s*createConversationStub\(/);
  assert.match(
    branch,
    /persistGatewayTranscript\(\{[\s\S]*?initialStubState: await initialStubState,[\s\S]*?deps: \{ loadConversation, saveConversation, withConversationLock \}/,
  );
  assert.match(
    helperSource,
    /withConversationLock\(args\.sessionId,[\s\S]*?loadConversation\(args\.sessionId\)[\s\S]*?initialStubState\.kind !== "failed-before-exists"[\s\S]*?saveConversation\(conversation\)/,
  );
  assert.doesNotMatch(
    branch,
    /\.catch\(\(\) => false\)/,
    "Gateway stub failures must retain their failure state instead of becoming a false no-op",
  );
  assert.match(branch, /console\.warn\("\[chat\] Failed to persist Gateway transcript", error\)/);
});
