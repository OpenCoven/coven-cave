// @ts-nocheck
//
// Production-path barrier/deadlock proof for the familiar-lifecycle mutex
// (cave-client-v1 Task 5/7 followup #2). Deliberately does NOT set any path
// override — only `COVEN_HOME` (real cave-home paths, real reconciliation,
// real dedicated `withFamiliarLifecycleLock`) — so this exercises the actual
// production code path: `withConfigLock`/`saveConfig`, `withFamiliarLifecycleGuard`,
// the familiar-removal DELETE route, and `createClientConversation` all run
// unmodified, exactly as they would in a running Cave process.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tmp = await mkdtemp(path.join(os.tmpdir(), "familiar-lifecycle-guard-production-path-"));
process.env.COVEN_HOME = tmp;
delete process.env.COVEN_CAVE_HOME;
delete process.env.CAVE_PROJECTS_PATH_OVERRIDE;
delete process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE;
delete process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE;
delete globalThis.__caveHomeMigration;

async function withDeadlockGuard<T>(label: string, promise: Promise<T>, timeoutMs = 5_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: did not resolve within ${timeoutMs}ms — possible deadlock`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timedOut]);
  } finally {
    clearTimeout(timer!);
  }
}

try {
  const { loadConfig, loadState, saveConfig, withFamiliarLifecycleGuard } = await import("./cave-config.ts");
  const { loadProjects } = await import("./cave-projects.ts");
  const {
    createClientConversation,
    patchClientConversation,
  } = await import("./server/client-v1/chat-service.ts");
  const { DELETE: deleteFamiliarRoute } = await import(
    "../app/api/familiars/[id]/route.ts"
  );

  const FAMILIAR_ID = "prod-lifecycle-fam";
  await saveConfig({ familiars: { [FAMILIAR_ID]: { harness: "codex" } } });

  // ── deadlock proof: the guard's callback may load config/projects/state ──
  {
    const result = await withDeadlockGuard(
      "withFamiliarLifecycleGuard callback loading config+projects+state",
      withFamiliarLifecycleGuard(async (config) => {
        // Every one of these goes through the SAME global reconciliation
        // lock the guard itself briefly used to load `config` above — under
        // the previous (non-dedicated) locking, a guard that held that same
        // lock open across its callback would have hung forever here.
        const reloadedConfig = await loadConfig();
        const projects = await loadProjects();
        const state = await loadState();
        return {
          hasConfig: Boolean(config),
          hasReloadedConfig: Boolean(reloadedConfig),
          hasProjects: Array.isArray(projects),
          hasState: Boolean(state),
        };
      }),
    );
    assert.deepEqual(result, {
      hasConfig: true,
      hasReloadedConfig: true,
      hasProjects: true,
      hasState: true,
    });
  }

  // The real PATCH path must not reacquire reconciliation while its state
  // transaction is open. No path overrides are set in this file.
  {
    const created = await withDeadlockGuard(
      "production create before PATCH deadlock proof",
      createClientConversation(
        { familiarId: FAMILIAR_ID, projectRoot: null },
        "prod-patch-deadlock-proof",
      ),
    );
    assert.equal(created.ok, true);
    const patched = await withDeadlockGuard(
      "production PATCH receipt projection",
      patchClientConversation("prod-patch-deadlock-proof", { title: "Still responsive" }),
    );
    assert.equal(patched.ok, true, "PATCH resolves without reconciliation self-deadlock");
    assert.equal(patched.ok && patched.conversation.title, "Still responsive");
  }

  // ── same-process barrier: a familiar removal requested during an
  //    in-flight create/PATCH/DELETE-shaped effect waits behind it ────────
  {
    const order: string[] = [];
    let releaseEffect: () => void;
    const effectGate = new Promise<void>((resolve) => {
      releaseEffect = resolve;
    });

    // Stands in for an in-flight client create/PATCH/DELETE: it holds the
    // SAME dedicated familiar-lifecycle lock a real conversation effect
    // would (chat-service.ts's create/patch/delete all wrap with this exact
    // guard) for as long as its own effect needs.
    const effectPromise = withDeadlockGuard(
      "in-flight familiar-lifecycle effect",
      withFamiliarLifecycleGuard(async (config) => {
        order.push("effect-start");
        const stillBound = Object.hasOwn(config.familiars ?? {}, FAMILIAR_ID);
        await effectGate;
        order.push("effect-end");
        return stillBound;
      }),
    );

    while (order.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));

    let removalSettled = false;
    const removalPromise = deleteFamiliarRoute(new Request("http://local/api/familiars/" + FAMILIAR_ID, { method: "DELETE" }), {
      params: Promise.resolve({ id: FAMILIAR_ID }),
    }).then((response) => {
      removalSettled = true;
      return response;
    });

    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(
      removalSettled,
      false,
      "a familiar removal racing a still-running lifecycle effect must queue behind the dedicated lock",
    );
    assert.deepEqual(order, ["effect-start"], "the in-flight effect must still be blocked mid-flight");

    releaseEffect();
    const [effectResult, removalResponse] = await Promise.all([effectPromise, removalPromise]);
    assert.equal(effectResult, true, "the in-flight effect observed the binding as still present at entry");
    assert.deepEqual(order, ["effect-start", "effect-end"], "the effect ran to completion before removal could proceed");
    const removalBody = await removalResponse.json();
    assert.equal(removalBody.ok, true, "the removal itself succeeded once unblocked");
    assert.equal(removalBody.hadBinding, true);

    // ── after removal: subsequent create/PATCH/DELETE denies ──────────────
    const createResult = await withDeadlockGuard(
      "createClientConversation after familiar removal",
      createClientConversation({ familiarId: FAMILIAR_ID, projectRoot: null }),
    );
    assert.equal(createResult.ok, false, "a create issued after the familiar was removed must deny, not succeed");
    assert.equal(createResult.code, "not_found", "the denial must be the familiar-not-found path");

    const configAfter = await loadConfig();
    assert.equal(
      Object.hasOwn(configAfter.familiars ?? {}, FAMILIAR_ID),
      false,
      "the binding must actually be gone from persisted config after removal",
    );
  }

  console.log("familiar-lifecycle-guard-production-path.test.ts: ok");
} finally {
  delete process.env.COVEN_HOME;
  delete globalThis.__caveHomeMigration;
  await rm(tmp, { recursive: true, force: true });
}
