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
  deleteConversation,
  loadConversation,
  saveConversation,
  withConversationLock,
} = await import("@/lib/cave-conversations");
const { appendVoiceOriginTurn } = await import("@/lib/voice/append-voice-turn");
const { DELETE, PATCH } = await import("../conversation/[id]/route.ts");

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

// Mirrors the Gateway completion's authoritative load→append→save contract.
// The source contract below ties this race harness to the production branch.
async function gatewayCompletion(id: string): Promise<boolean> {
  return withConversationLock(id, async () => {
    const conv = await loadConversation(id);
    if (!conv) return false;
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
    await saveConversation(conv);
    return true;
  });
}

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
  await seed(id);
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
  const gateway = gatewayCompletion(id);

  barrier.release();
  await barrier.held;
  assert.equal((await deletion).status, 200);
  assert.equal(await gateway, false);
  assert.equal(await loadConversation(id), null);
  assert.equal(await deleteConversation(id), false);
});

test("production OpenClaw Gateway persistence holds the shared lock for the full RMW and fails closed after delete", async () => {
  const source = await readFile(new URL("../../../../lib/server/chat-send-service.ts", import.meta.url), "utf8");
  const start = source.indexOf('if (gatewayDispatch.kind === "accepted")');
  const end = source.indexOf("const openclawLaunch = openClawLaunchCommand()", start);
  assert.ok(start >= 0 && end > start);
  const branch = source.slice(start, end);
  assert.match(branch, /withConversationLock\(conversationId,\s*async \(\) => \{/);
  assert.match(
    branch,
    /withConversationLock\(conversationId,[\s\S]*?loadConversation\(conversationId\)[\s\S]*?if \(!existing\) throw[\s\S]*?saveConversation\(conv\)/,
  );
  assert.doesNotMatch(
    branch,
    /const existing = await loadConversation\(conversationId\);[\s\S]*?const conv = existing \?\?/,
    "a deleted Gateway conversation must never be recreated from a fallback snapshot",
  );
});
