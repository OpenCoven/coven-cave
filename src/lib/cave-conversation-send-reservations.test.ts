import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(".validation/side-lifecycle-0fd562c1", `reservations-${process.pid}`);
const workspace = path.join(root, "project");
await mkdir(workspace, { recursive: true });
const previous = { HOME: process.env.HOME, COVEN_HOME: process.env.COVEN_HOME,
  COVEN_CAVE_HOME: process.env.COVEN_CAVE_HOME, HERMES_BIN: process.env.HERMES_BIN,
  HERMES_API_URL: process.env.HERMES_API_URL, HERMES_API_KEY: process.env.HERMES_API_KEY,
  CAVE_PROJECTS_PATH_OVERRIDE: process.env.CAVE_PROJECTS_PATH_OVERRIDE,
  CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE: process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE };
process.env.HOME = root;
process.env.COVEN_HOME = path.join(root, ".coven");
process.env.COVEN_CAVE_HOME = path.join(root, ".coven", "cave");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(root, "projects.json");
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(root, "permissions.json");
delete process.env.HERMES_API_URL;
delete process.env.HERMES_API_KEY;
const store = await import("./cave-conversations.ts");
const { createSideConversationService, sideConversationBranch } = await import("./server/chat-side-conversations.ts");
type Conversation = import("./cave-conversations.ts").ConversationFile;
type BringBackInput = import("./server/chat-side-conversations.ts").BringBackInput;
const service = createSideConversationService({ authorize: async () => {} });
const nodeArgs = ["--experimental-strip-types", "--import", "./scripts/test-alias-register.mjs", "--input-type=module", "-e"];
async function load(id: string) {
  const value = await store.loadConversation(id);
  assert.ok(value);
  return value;
}
function seed(id: string): Conversation {
  return { sessionId: id, familiarId: "cody", harness: "hermes", harnessSessionId: "native-before",
    runtime: `local:${workspace}`, updatedAt: "2026-09-09T00:00:00.000Z", activeLeafId: "seed-turn",
    turns: [{ id: "seed-turn", parentId: null, role: "user", text: "Parent before sender", createdAt: "2026-09-09T00:00:00.000Z" }] };
}
async function prepare(id: string) {
  const parent = seed(id);
  await store.saveConversation(parent);
  const scope = { parentSessionId: id, familiarId: "cody", projectId: "project-one" };
  const side = await service.create({ operationId: `side-${id}`, scope, expectedParent: sideConversationBranch(parent),
    context: { mode: "fresh", turnIds: [] }, retention: "retained", draftText: "Reviewed side result" });
  const input: BringBackInput = { operationId: `import-${id}`, scope, targetSessionId: id,
    expectedTarget: sideConversationBranch(parent), expectedSource: sideConversationBranch(side.conversation),
    sourceTurnIds: [side.conversation.turns[0].id], reviewedText: "Explicit reviewed result" };
  return { parent, side: side.conversation, input };
}
function importInFreshProcess(sideId: string, input: BringBackInput): string {
  const code = `
    const {createSideConversationService}=await import('./src/lib/server/chat-side-conversations.ts');
    try {
      const result=await createSideConversationService({authorize:async()=>{}}).bringBack(${JSON.stringify(sideId)},${JSON.stringify(input)});
      console.log(result.receipt.turnId);
    } catch(error) {
      if(error.code==='target_generation_active')console.log(error.code);else throw error;
    }
  `;
  const child = spawnSync(process.execPath, [...nodeArgs, code], { env: process.env, encoding: "utf8", timeout: 15_000 });
  assert.equal(child.status, 0, child.stderr);
  return child.stdout.trim();
}
async function waitFor(check: () => Promise<boolean>, label: string): Promise<void> {
  const until = Date.now() + 15_000;
  while (!(await check())) {
    if (Date.now() >= until) assert.fail(`timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
async function exists(file: string): Promise<boolean> {
  try { await readFile(file); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
try {
  const first = await prepare("sender-first");
  const reservation = await store.reserveConversationSend(first.parent.sessionId, "cody");
  assert.equal(reservation.conversation?.activeSendReservations?.length, 1);
  first.input.expectedTarget = sideConversationBranch(await load(first.parent.sessionId));
  assert.equal(importInFreshProcess(first.side.sessionId, first.input), "target_generation_active",
    "another process cannot import after the sender has taken its reserved snapshot");
  assert.equal((await load(first.parent.sessionId)).turns.length, 1);
  // Old writers must not accidentally clear the durable reservation.
  const oldWriter = { ...await load(first.parent.sessionId) };
  delete oldWriter.activeSendReservations;
  delete oldWriter.writeRevision;
  await store.saveConversation(oldWriter);
  assert.equal((await load(first.parent.sessionId)).activeSendReservations?.length, 1);
  await store.withConversationLock(first.parent.sessionId, async () => {
    const finished = await load(first.parent.sessionId);
    finished.turns.push({ id: "sender-final", parentId: reservation.conversation!.activeLeafId,
      role: "assistant", text: "Sender result", createdAt: "2026-09-09T00:00:01.000Z" });
    finished.activeLeafId = "sender-final";
    await store.saveConversation(finished);
  });
  first.input.expectedTarget = sideConversationBranch(await load(first.parent.sessionId));
  assert.equal(importInFreshProcess(first.side.sessionId, first.input), "target_generation_active",
    "final save alone does not release the sender reservation");
  await reservation.release();
  await reservation.release();
  assert.equal((await load(first.parent.sessionId)).activeSendReservations, undefined);
  const importedId = importInFreshProcess(first.side.sessionId, {
    ...first.input, expectedTarget: sideConversationBranch(await load(first.parent.sessionId)),
  });
  const imported = await load(first.parent.sessionId);
  assert.equal(imported.activeLeafId, importedId);
  assert.equal(imported.turns.at(-1)?.parentId, "sender-final");
  const importFirst = await store.reserveConversationSend(first.parent.sessionId, "cody");
  assert.equal(importFirst.conversation?.activeLeafId, importedId, "the opposite ordering snapshots the committed import");
  await importFirst.release();
  const one = await store.reserveConversationSend(first.parent.sessionId, "cody");
  const two = await store.reserveConversationSend(first.parent.sessionId, "cody");
  await one.release();
  assert.equal((await load(first.parent.sessionId)).activeSendReservations?.length, 1);
  await one.release();
  assert.equal((await load(first.parent.sessionId)).activeSendReservations?.length, 1, "one completion cannot release another sender");
  await two.release();
  assert.equal((await load(first.parent.sessionId)).activeSendReservations, undefined);

  const interrupted = await prepare("interrupted-sender");
  const owner = spawnSync(process.execPath, [...nodeArgs,
    `const {reserveConversationSend}=await import('./src/lib/cave-conversations.ts'); await reserveConversationSend('interrupted-sender','cody');`],
  { env: process.env, encoding: "utf8", timeout: 15_000 });
  assert.equal(owner.status, 0, owner.stderr);
  assert.equal(importInFreshProcess(interrupted.side.sessionId, {
    ...interrupted.input, expectedTarget: sideConversationBranch(await load("interrupted-sender")),
  }), "target_generation_active", "a lost sender process does not expire the durable reservation");
  const missing = await store.reserveConversationSend("materializing-parent", "cody");
  assert.equal(missing.conversation, null);
  const materialized = await prepare("materializing-parent");
  assert.equal(importInFreshProcess(materialized.side.sessionId, materialized.input), "target_generation_active",
    "a reserved ID stays fenced when its transcript first appears after the initial read");
  await missing.release();
  assert.ok(importInFreshProcess(materialized.side.sessionId, {
    ...materialized.input, expectedTarget: sideConversationBranch(await load("materializing-parent")),
  }).startsWith("import-"));

  if (process.platform !== "win32") {
    const started = path.join(root, "runtime-started");
    const release = path.join(root, "runtime-release");
    const fixture = path.join(root, "hermes-fixture.mjs");
    const executable = path.join(root, "hermes-fixture");
    await writeFile(fixture, `
      import {existsSync,writeFileSync,writeSync} from 'node:fs';
      if(!process.argv.includes('chat'))process.exit(0);
      writeFileSync(${JSON.stringify(started)},'started');
      writeSync(2,'session_id: native-before\\n');
      const deadline=setTimeout(()=>process.exit(1),15000);
      const interval=setInterval(()=>{
        if(existsSync(${JSON.stringify(release)})){
          clearInterval(interval);
          clearTimeout(deadline);
          writeSync(1,'Sender final answer\\n');
        }
      },10);
    `);
    await writeFile(executable, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fixture)} "$@"\n`, { mode: 0o755 });
    process.env.HERMES_BIN = executable;
    await mkdir(process.env.COVEN_HOME!, { recursive: true });
    await writeFile(path.join(process.env.COVEN_HOME!, "familiars.toml"), [
      "[[familiar]]", 'id = "cody"', 'display_name = "Cody"', `workspace = ${JSON.stringify(workspace)}`,
    ].join("\n"));
    const { saveConfig } = await import("./cave-config.ts");
    const { createProject } = await import("./cave-projects.ts");
    const { grantProjectToFamiliar } = await import("./project-permissions.ts");
    await saveConfig({ familiars: { cody: { harness: "hermes" } } });
    const project = await createProject({ name: "Sender reservation fixture", root: workspace });
    await grantProjectToFamiliar({ familiarId: "cody", projectId: project.id, source: "human", access: "write" });
    const real = await prepare("actual-sender");
    const { POST } = await import("../app/api/chat/send/route.ts");
    const abort = new AbortController();
    const response = await POST(new Request("http://localhost/api/chat/send", {
      method: "POST", headers: { "content-type": "application/json" }, signal: abort.signal,
      body: JSON.stringify({ familiarId: "cody", sessionId: real.parent.sessionId, prompt: "Continue this conversation.",
        projectRoot: workspace, parentTurnId: "seed-turn" }),
    }));
    assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text());
    try {
      await waitFor(() => exists(started), "fixture runtime launch");
      assert.equal((await load(real.parent.sessionId)).activeSendReservations?.length, 1);
      assert.equal(importInFreshProcess(real.side.sessionId, {
        ...real.input, expectedTarget: sideConversationBranch(await load(real.parent.sessionId)),
      }), "target_generation_active");
      abort.abort();
      await response.body?.cancel();
      assert.equal(importInFreshProcess(real.side.sessionId, {
        ...real.input, expectedTarget: sideConversationBranch(await load(real.parent.sessionId)),
      }), "target_generation_active", "transport cancellation cannot release a detached sender's reservation");
    } finally { await writeFile(release, "finish"); }
    await waitFor(async () => {
      const target = await load(real.parent.sessionId);
      return target.activeSendReservations === undefined && target.turns.some((turn) => turn.text.includes("Sender final answer"));
    }, "detached runtime persistence and reservation settlement");
    const finalized = await load(real.parent.sessionId);
    const afterRuntime = await service.bringBack(real.side.sessionId, {
      ...real.input, expectedTarget: sideConversationBranch(finalized),
    });
    assert.equal(afterRuntime.conversation.turns.at(-1)?.parentId, finalized.activeLeafId);
    assert.equal(afterRuntime.conversation.activeLeafId, afterRuntime.receipt.turnId);
    const refused = await POST(new Request("http://localhost/api/chat/send", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiarId: "cody", sessionId: real.parent.sessionId, prompt: "Invalid host.",
        projectRoot: workspace, runtimeHost: "unregistered-fixture-host" }),
    }));
    if (refused.status < 400) await refused.text();
    assert.ok(refused.status >= 400, "pre-stream host validation rejects the request");
    assert.equal((await load(real.parent.sessionId)).activeSendReservations, undefined,
      "pre-stream rejection releases only its own reservation");
  }
  console.log("send reservations: both lock orderings, independent processes, interruption and actual detached sender passed");
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await rm(root, { recursive: true, force: true });
}
