import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const testRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testRoot, { recursive: true });
const home = await mkdtemp(path.join(testRoot, "conversation-cross-process-lock-"));
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.COVEN_HOME = path.join(home, "coven");

const {
  conversationLockDbPath,
} = await import("./server/conversation-transaction-lock.ts");
const {
  loadConversation,
  saveConversation,
  withConversationLock,
} = await import("./cave-conversations.ts");
const { getSessionDeletionGeneration } = await import("./cave-config.ts");

const conversationModuleUrl = pathToFileURL(path.resolve("src/lib/cave-conversations.ts")).href;
const configModuleUrl = pathToFileURL(path.resolve("src/lib/cave-config.ts")).href;
const gatewayPersistenceModuleUrl = pathToFileURL(
  path.resolve("src/app/api/chat/send/gateway-transcript-persistence.ts"),
).href;
const conversationRouteModuleUrl = pathToFileURL(
  path.resolve("src/app/api/chat/conversation/[id]/route.ts"),
).href;

after(async () => {
  await rm(home, { recursive: true, force: true });
});

function childEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    COVEN_CAVE_HOME: path.join(home, "cave"),
    COVEN_HOME: path.join(home, "coven"),
  };
}

function childArgs(source: string): string[] {
  return [
    "--experimental-strip-types",
    "--import",
    "./scripts/test-alias-register.mjs",
    "--input-type=module",
    "--eval",
    source,
  ];
}

function spawnWorker(source: string) {
  const child = spawn(process.execPath, childArgs(source), {
    cwd: process.cwd(),
    env: childEnvironment(),
    windowsHide: true,
  });
  let output = "";
  let exited = false;
  let exitCode: number | null = null;
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const exit = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => {
      exited = true;
      exitCode = code;
      resolve(code);
    });
  });

  async function waitFor(marker: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!output.includes(marker)) {
      if (exited || Date.now() >= deadline) {
        throw new Error(`worker exited before ${marker}: code=${exitCode}, output=${output}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  return {
    child,
    exit,
    waitFor,
    get output() {
      return output;
    },
  };
}

function conversationSeed(sessionId: string) {
  const now = "2026-08-14T00:00:00.000Z";
  return {
    sessionId,
    familiarId: "wren",
    harness: "openclaw",
    runtime: `local:${home}`,
    createdAt: now,
    updatedAt: now,
    turns: [],
  };
}

test("a subprocess DELETE cannot pass Gateway's deletion-generation check and resurrect its transcript before the fenced save", async () => {
  const id = "gateway-cross-process-delete-race";
  const releaseFile = path.join(home, "gateway-release");
  const gateway = spawnWorker(`
    const { loadConversation, saveConversation, withConversationLock } = await import(${JSON.stringify(conversationModuleUrl)});
    const { getSessionDeletionGeneration } = await import(${JSON.stringify(configModuleUrl)});
    const { persistGatewayTranscript } = await import(${JSON.stringify(gatewayPersistenceModuleUrl)});
    const fs = await import("node:fs/promises");
    await persistGatewayTranscript({
      sessionId: ${JSON.stringify(id)},
      initialStubState: { kind: "failed-before-exists", deletionGeneration: 0 },
      deps: { loadConversation, saveConversation, withConversationLock, getDeletionGeneration: getSessionDeletionGeneration },
      createAfterInitialStubFailure: () => ({
        sessionId: ${JSON.stringify(id)},
        familiarId: "wren",
        harness: "openclaw",
        runtime: ${JSON.stringify(`local:${home}`)},
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
        turns: [],
      }),
      complete: async (conversation) => {
        process.stdout.write("GENERATION_CHECKED\\n");
        for (;;) {
          try {
            await fs.stat(${JSON.stringify(releaseFile)});
            break;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
        conversation.turns.push({
          id: "gateway-turn",
          role: "assistant",
          text: "fenced",
          createdAt: "2026-08-14T00:00:01.000Z",
          parentId: null,
        });
      },
    });
    process.stdout.write("GATEWAY_SAVED\\n");
  `);
  await gateway.waitFor("GENERATION_CHECKED");

  const deleter = spawnWorker(`
    const { DELETE } = await import(${JSON.stringify(conversationRouteModuleUrl)});
    const response = await DELETE(
      new Request("http://test/api/chat/conversation/${id}", { method: "DELETE" }),
      { params: Promise.resolve({ id: ${JSON.stringify(id)} }) },
    );
    process.stdout.write("DELETE_STATUS:" + response.status + "\\n");
  `);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.doesNotMatch(
    deleter.output,
    /DELETE_STATUS:/,
    "DELETE must wait behind Gateway's same-session cross-process fence",
  );

  await writeFile(releaseFile, "release", "utf8");
  assert.equal(await gateway.exit, 0, gateway.output);
  assert.equal(await deleter.exit, 0, deleter.output);
  assert.match(deleter.output, /DELETE_STATUS:200/);
  assert.equal(await loadConversation(id), null, "the queued DELETE removes the completed Gateway transcript");
  assert.equal(await getSessionDeletionGeneration(id), 1);
});

test("concurrent subprocess conversation saves retain both normal read-modify-write updates", async () => {
  const id = "concurrent-normal-saves";
  await saveConversation(conversationSeed(id));
  const startAt = Date.now() + 500;
  const worker = (turnId: string) => `
    const { loadConversation, saveConversation, withConversationLock } = await import(${JSON.stringify(conversationModuleUrl)});
    const waitMs = Math.max(0, ${startAt} - Date.now());
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    await withConversationLock(${JSON.stringify(id)}, async () => {
      const conversation = await loadConversation(${JSON.stringify(id)});
      if (!conversation) throw new Error("seed conversation disappeared");
      conversation.turns.push({
        id: ${JSON.stringify(turnId)},
        role: "assistant",
        text: ${JSON.stringify(turnId)},
        createdAt: "2026-08-14T00:00:01.000Z",
        parentId: null,
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      await saveConversation(conversation);
    });
  `;
  const results = await Promise.all(
    ["normal-save-one", "normal-save-two"].map((turnId) =>
      execFileAsync(process.execPath, childArgs(worker(turnId)), {
        cwd: process.cwd(),
        env: childEnvironment(),
        windowsHide: true,
      }),
    ),
  );
  assert.deepEqual(results.map((result) => result.stderr), ["", ""]);
  assert.deepEqual(
    (await loadConversation(id))?.turns.map((turn) => turn.id).sort(),
    ["normal-save-one", "normal-save-two"],
  );
});

test("a SIGKILLed subprocess holder releases its conversation fence without stale-owner recovery", async () => {
  const id = "crashed-conversation-lock-holder";
  const holder = spawnWorker(`
    const { withConversationLock } = await import(${JSON.stringify(conversationModuleUrl)});
    await withConversationLock(${JSON.stringify(id)}, async () => {
      process.stdout.write("ACQUIRED\\n");
      await new Promise(() => {});
    });
  `);
  await holder.waitFor("ACQUIRED");
  holder.child.kill("SIGKILL");
  await holder.exit;

  const startedAt = Date.now();
  const result = await withConversationLock(id, async () => "recovered");
  const waitedMs = Date.now() - startedAt;
  assert.equal(result, "recovered");
  assert.ok(waitedMs < 3_000, `kernel release should recover promptly, waited ${waitedMs}ms`);
});

test("a subprocess lock-acquisition failure propagates and releases its in-process queue slot", async () => {
  const id = "conversation-lock-acquisition-failure";
  const transcriptPath = path.join(home, "cave", "conversations", `${id}.json`);
  await mkdir(conversationLockDbPath(transcriptPath), { recursive: true });
  const result = await execFileAsync(
    process.execPath,
    childArgs(`
      const { withConversationLock } = await import(${JSON.stringify(conversationModuleUrl)});
      try {
        await withConversationLock(${JSON.stringify(id)}, async () => "must not run");
        process.stdout.write("UNEXPECTED_SUCCESS\\n");
        process.exitCode = 1;
      } catch (error) {
        process.stdout.write("ACQUISITION_FAILED:" + (error instanceof Error ? error.message : String(error)) + "\\n");
      }
    `),
    { cwd: process.cwd(), env: childEnvironment(), windowsHide: true },
  );
  assert.match(result.stdout, /ACQUISITION_FAILED:/);
  assert.doesNotMatch(result.stdout, /UNEXPECTED_SUCCESS/);
});
