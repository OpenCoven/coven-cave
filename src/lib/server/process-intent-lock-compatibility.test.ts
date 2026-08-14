import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";

import { acquireProcessIntentLock } from "./process-intent-lock.ts";
import { acquireBaseProcessIntentLock } from "./process-intent-lock-base-fixture.ts";
import { acquireLegacyProcessIntentLock } from "./process-intent-lock-legacy-fixture.ts";

const workerMode = process.env.PROCESS_INTENT_COMPAT_WORKER as
  | "base"
  | "legacy"
  | "current"
  | undefined;

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(file: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await exists(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`timed out waiting for ${file}`);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function runWorker(mode: "base" | "legacy" | "current"): Promise<void> {
  const directory = process.env.PROCESS_INTENT_COMPAT_DIRECTORY!;
  const markerDirectory = process.env.PROCESS_INTENT_COMPAT_MARKERS!;
  const workerId = process.env.PROCESS_INTENT_COMPAT_WORKER_ID!;
  const crashStage = process.env.PROCESS_INTENT_CRASH_STAGE;
  const waiting = async () => {
    await writeFile(
      path.join(markerDirectory, `waiting-${workerId}`),
      "waiting\n",
    );
  };
  const common = {
    intentsDirectory: directory,
    label: `${mode} compatibility worker`,
    timeoutMs: 10_000,
  };
  const release = mode === "current"
    ? await acquireProcessIntentLock({
        ...common,
        acquisitionStage: async (stage) => {
          if (
            stage === "waiting-for-pre-barrier-legacy" ||
            stage === "waiting-for-current"
          ) {
            await waiting();
          }
        },
        ...(crashStage
          ? {
              publicationStage: async (stage: string) => {
                if (stage !== crashStage) return;
                await writeFile(
                  path.join(markerDirectory, `crash-${stage}`),
                  "reached\n",
                );
                await new Promise<void>(() => {});
              },
            }
          : {}),
      })
    : mode === "base"
      ? await acquireBaseProcessIntentLock({ ...common, onWait: waiting })
      : await acquireLegacyProcessIntentLock({ ...common, onWait: waiting });
  const criticalSection = path.join(markerDirectory, "critical-section");
  try {
    try {
      await mkdir(criticalSection);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        await writeFile(path.join(markerDirectory, "overlap"), `${workerId}\n`);
      }
      throw error;
    }
    await writeFile(path.join(markerDirectory, `entered-${workerId}`), "entered\n");
    await waitFor(path.join(markerDirectory, `release-${workerId}`));
  } finally {
    await rm(criticalSection, { recursive: true, force: true });
    await release();
  }
}

if (workerMode) {
  await runWorker(workerMode);
} else {
  const temporary = await mkdtemp(
    path.join(process.cwd(), ".process-intent-compat-test-"),
  );

  after(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  function startWorker(
    mode: "base" | "legacy" | "current",
    directory: string,
    markerDirectory: string,
    id: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--experimental-strip-types",
          import.meta.filename,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PROCESS_INTENT_COMPAT_WORKER: mode,
            PROCESS_INTENT_COMPAT_DIRECTORY: directory,
            PROCESS_INTENT_COMPAT_MARKERS: markerDirectory,
            PROCESS_INTENT_COMPAT_WORKER_ID: id,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk) => {
        output += chunk;
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${mode} worker exited ${code}: ${output}`));
      });
    });
  }

  function startCrashWorker(
    directory: string,
    markerDirectory: string,
    stage: string,
  ): ChildProcess {
    return spawn(
      process.execPath,
      ["--experimental-strip-types", import.meta.filename],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PROCESS_INTENT_COMPAT_WORKER: "current",
          PROCESS_INTENT_COMPAT_DIRECTORY: directory,
          PROCESS_INTENT_COMPAT_MARKERS: markerDirectory,
          PROCESS_INTENT_COMPAT_WORKER_ID: "crash",
          PROCESS_INTENT_CRASH_STAGE: stage,
        },
        stdio: "ignore",
      },
    );
  }

  for (const [holderMode, contenderMode] of [
    ["base", "current"],
    ["current", "base"],
    ["legacy", "current"],
    ["current", "legacy"],
  ] as const) {
    test(`${holderMode} holder excludes ${contenderMode} contender`, async () => {
      const caseRoot = path.join(temporary, `${holderMode}-${contenderMode}`);
      const directory = path.join(caseRoot, "locks");
      const markers = path.join(caseRoot, "markers");
      await mkdir(markers, { recursive: true });
      const holder = startWorker(holderMode, directory, markers, "holder");
      await waitFor(path.join(markers, "entered-holder"));
      const contender = startWorker(
        contenderMode,
        directory,
        markers,
        "contender",
      );
      await waitFor(path.join(markers, "waiting-contender"));
      assert.equal(await exists(path.join(markers, "overlap")), false);
      assert.equal(
        await exists(path.join(markers, "entered-contender")),
        false,
        `${contenderMode} must wait while ${holderMode} owns the lock`,
      );

      await writeFile(path.join(markers, "release-holder"), "release\n");
      await holder;
      await waitFor(path.join(markers, "entered-contender"));
      assert.equal(await exists(path.join(markers, "overlap")), false);
      await writeFile(path.join(markers, "release-contender"), "release\n");
      await contender;
      assert.equal(
        await readFile(path.join(markers, "entered-contender"), "utf8"),
        "entered\n",
      );
    });
  }

  test("a current lower-order publication yields to a live legacy owner", async () => {
    const caseRoot = path.join(temporary, "paused-current-legacy-owner");
    const directory = path.join(caseRoot, "locks");
    const currentPaused = deferred();
    const resumeCurrent = deferred();
    let pauseOnce = false;
    let currentEntered = false;
    const currentWaiting = deferred();
    const current = acquireProcessIntentLock({
      intentsDirectory: directory,
      label: "paused current compatibility contender",
      publicationStage: async (stage) => {
        if (stage !== "gate-name-selected" || pauseOnce) return;
        pauseOnce = true;
        currentPaused.resolve();
        await resumeCurrent.promise;
      },
      acquisitionStage: async (stage) => {
        if (stage === "waiting-for-pre-barrier-legacy") {
          currentWaiting.resolve();
        }
      },
    }).then((release) => {
      currentEntered = true;
      return release;
    });
    await currentPaused.promise;
    const releaseLegacy = await acquireBaseProcessIntentLock({
      intentsDirectory: directory,
      label: "live legacy compatibility owner",
    });
    resumeCurrent.resolve();
    await currentWaiting.promise;
    assert.equal(
      currentEntered,
      false,
      "the late lower-order current gate must yield behind the live legacy gate",
    );
    await releaseLegacy();
    const releaseCurrent = await current;
    await releaseCurrent();
  });

  for (const [fixtureName, acquireFrozen] of [
    ["base", acquireBaseProcessIntentLock],
    ["legacy", acquireLegacyProcessIntentLock],
  ] as const) {
    test(`current restarts rather than cyclically waiting on a queued ${fixtureName} contender`, async () => {
      const directory = path.join(
        temporary,
        `current-before-post-barrier-${fixtureName}`,
      );
      const currentBarrierPublished = deferred();
      const resumeCurrent = deferred();
      const frozenWaiting = deferred();
      let frozenEntered = false;
      let currentEntered = false;
      let pauseOnce = false;
      const current = acquireProcessIntentLock({
        intentsDirectory: directory,
        label: `current before post-barrier ${fixtureName}`,
        timeoutMs: 5_000,
        publicationStage: async (stage) => {
          if (stage !== "gate-parent-synced" || pauseOnce) return;
          pauseOnce = true;
          currentBarrierPublished.resolve();
          await resumeCurrent.promise;
        },
      }).then((release) => {
        currentEntered = true;
        return release;
      });
      await currentBarrierPublished.promise;
      const frozen = acquireFrozen({
        intentsDirectory: directory,
        label: `${fixtureName} published behind current barrier`,
        timeoutMs: 5_000,
        onWait: async () => {
          frozenWaiting.resolve();
        },
      }).then((release) => {
        frozenEntered = true;
        return release;
      });
      await frozenWaiting.promise;
      resumeCurrent.resolve();

      const first = await Promise.race([
        current.then((release) => ({ owner: "current" as const, release })),
        frozen.then((release) => ({ owner: fixtureName, release })),
      ]);
      if (first.owner === "current") {
        await first.release();
        const releaseFrozen = await frozen;
        await releaseFrozen();
      } else {
        assert.equal(
          currentEntered,
          false,
          "current must retire its gate before the queued legacy contender drains",
        );
        await first.release();
        const releaseCurrent = await current;
        await releaseCurrent();
      }
      assert.equal(
        first.owner,
        fixtureName,
        `${fixtureName} must drain before current reacquires its barrier`,
      );
      assert.equal(frozenEntered, true);
    });
  }

  for (const [fixtureName, acquireFrozen] of [
    ["base", acquireBaseProcessIntentLock],
    ["legacy", acquireLegacyProcessIntentLock],
  ] as const) {
    test(
      `current rescans a backdated ${fixtureName} publication at the final quiescence boundary`,
      { timeout: 10_000 },
      async () => {
        const directory = path.join(
          temporary,
          `final-quiescence-backdated-${fixtureName}`,
        );
        const frozenNamed = deferred();
        const resumeFrozen = deferred();
        const currentQuiescent = deferred();
        const resumeCurrent = deferred();
        const currentWaiting = deferred();
        let pauseOnce = false;
        let currentEntered = false;
        const frozen = acquireFrozen({
          intentsDirectory: directory,
          label: `final-boundary ${fixtureName} publisher`,
          pauseAfterName: async () => {
            frozenNamed.resolve();
            await resumeFrozen.promise;
          },
        });
        await frozenNamed.promise;
        const current = acquireProcessIntentLock({
          intentsDirectory: directory,
          label: `current final-boundary ${fixtureName} contender`,
          timeoutMs: 5_000,
          publicationStage: async (stage) => {
            if (stage !== "legacy-quiescence-established" || pauseOnce) return;
            pauseOnce = true;
            currentQuiescent.resolve();
            await resumeCurrent.promise;
          },
          acquisitionStage: async (stage) => {
            if (stage === "waiting-for-pre-barrier-legacy") {
              currentWaiting.resolve();
            }
          },
        }).then((release) => {
          currentEntered = true;
          return release;
        });
        await currentQuiescent.promise;
        resumeFrozen.resolve();
        const releaseFrozen = await frozen;
        resumeCurrent.resolve();
        const outcome = await Promise.race([
          currentWaiting.promise.then(() => "waiting" as const),
          current.then(() => "acquired" as const),
        ]);
        const overlapped = currentEntered;
        if (outcome === "acquired") {
          const releaseCurrent = await current;
          await releaseCurrent();
        }
        await releaseFrozen();
        if (outcome === "waiting") {
          const releaseCurrent = await current;
          await releaseCurrent();
        }
        assert.equal(
          outcome,
          "waiting",
          "a publisher that could scan before the gate must force gate restart",
        );
        assert.equal(overlapped, false);
      },
    );
  }

  for (const [fixtureName, acquireFrozen] of [
    ["base", acquireBaseProcessIntentLock],
    ["legacy", acquireLegacyProcessIntentLock],
  ] as const) {
    test(`the quiescence probe catches an in-flight backdated ${fixtureName} publisher`, async () => {
      const directory = path.join(
        temporary,
        `quiescence-probe-backdated-${fixtureName}`,
      );
      const frozenNamed = deferred();
      const resumeFrozen = deferred();
      const frozenEntered = deferred();
      const currentWaiting = deferred();
      const frozen = acquireFrozen({
        intentsDirectory: directory,
        label: `backdated ${fixtureName} publisher`,
        pauseAfterName: async () => {
          frozenNamed.resolve();
          await resumeFrozen.promise;
        },
      }).then((release) => {
        frozenEntered.resolve();
        return release;
      });
      await frozenNamed.promise;
      let resumed = false;
      const current = acquireProcessIntentLock({
        intentsDirectory: directory,
        label: `current probing backdated ${fixtureName}`,
        publicationStage: async (stage) => {
          if (stage !== "quiescence-probe-published" || resumed) return;
          resumed = true;
          resumeFrozen.resolve();
          await frozenEntered.promise;
        },
        acquisitionStage: async (stage) => {
          if (stage === "waiting-for-pre-barrier-legacy") {
            currentWaiting.resolve();
          }
        },
      });
      await currentWaiting.promise;
      const releaseFrozen = await frozen;
      await releaseFrozen();
      const releaseCurrent = await current;
      await releaseCurrent();
    });
  }

  for (const [fixtureName, acquireFrozen] of [
    ["base", acquireBaseProcessIntentLock],
    ["legacy", acquireLegacyProcessIntentLock],
  ] as const) {
    test(`${fixtureName} paused after choosing a name cannot publish into a current holder`, async () => {
      const directory = path.join(
        temporary,
        `${fixtureName}-after-name-current-holder`,
      );
      const frozenPaused = deferred();
      const resumeFrozen = deferred();
      const frozenWaiting = deferred();
      let frozenEntered = false;
      const frozen = acquireFrozen({
        intentsDirectory: directory,
        label: `${fixtureName} paused after name`,
        pauseAfterName: async () => {
          frozenPaused.resolve();
          await resumeFrozen.promise;
        },
        onWait: async () => {
          frozenWaiting.resolve();
        },
      }).then((release) => {
        frozenEntered = true;
        return release;
      });
      await frozenPaused.promise;
      const releaseCurrent = await acquireProcessIntentLock({
        intentsDirectory: directory,
        label: `current holder before late ${fixtureName} publication`,
      });
      resumeFrozen.resolve();
      await frozenWaiting.promise;
      assert.equal(
        frozenEntered,
        false,
        `${fixtureName} must observe the current migration barrier`,
      );
      await releaseCurrent();
      const releaseFrozen = await frozen;
      await releaseFrozen();
    });

    test(`current holder excludes ${fixtureName} paused after its scan`, async () => {
      const directory = path.join(
        temporary,
        `current-holder-${fixtureName}-after-scan`,
      );
      const releaseCurrent = await acquireProcessIntentLock({
        intentsDirectory: directory,
        label: `current holder before ${fixtureName} scan`,
      });
      const frozenPaused = deferred();
      const resumeFrozen = deferred();
      const frozenWaiting = deferred();
      let frozenEntered = false;
      const frozen = acquireFrozen({
        intentsDirectory: directory,
        label: `${fixtureName} paused after current-holder scan`,
        pauseAfterScan: async () => {
          frozenPaused.resolve();
          await resumeFrozen.promise;
        },
        onWait: async () => {
          frozenWaiting.resolve();
        },
      }).then((release) => {
        frozenEntered = true;
        return release;
      });
      await frozenPaused.promise;
      resumeFrozen.resolve();
      await frozenWaiting.promise;
      assert.equal(frozenEntered, false);
      await releaseCurrent();
      const releaseFrozen = await frozen;
      await releaseFrozen();
    });

    test(`${fixtureName} paused after choosing a name waits for an existing current holder`, async () => {
      const directory = path.join(
        temporary,
        `current-holder-${fixtureName}-after-name`,
      );
      const releaseCurrent = await acquireProcessIntentLock({
        intentsDirectory: directory,
        label: `current holder before ${fixtureName} name selection`,
      });
      const frozenPaused = deferred();
      const resumeFrozen = deferred();
      const frozenWaiting = deferred();
      let frozenEntered = false;
      const frozen = acquireFrozen({
        intentsDirectory: directory,
        label: `${fixtureName} paused after name with current holder`,
        pauseAfterName: async () => {
          frozenPaused.resolve();
          await resumeFrozen.promise;
        },
        onWait: async () => {
          frozenWaiting.resolve();
        },
      }).then((release) => {
        frozenEntered = true;
        return release;
      });
      await frozenPaused.promise;
      resumeFrozen.resolve();
      await frozenWaiting.promise;
      assert.equal(
        frozenEntered,
        false,
        `${fixtureName} must queue behind the current migration barrier`,
      );
      await releaseCurrent();
      const releaseFrozen = await frozen;
      await releaseFrozen();
    });

    test(`current waits for ${fixtureName} paused after its winning scan`, async () => {
      const directory = path.join(
        temporary,
        `${fixtureName}-after-scan-before-current`,
      );
      const frozenPaused = deferred();
      const resumeFrozen = deferred();
      const currentWaiting = deferred();
      let currentEntered = false;
      const frozen = acquireFrozen({
        intentsDirectory: directory,
        label: `${fixtureName} paused after winning scan`,
        pauseAfterScan: async () => {
          frozenPaused.resolve();
          await resumeFrozen.promise;
        },
      });
      await frozenPaused.promise;
      const current = acquireProcessIntentLock({
        intentsDirectory: directory,
        label: `current after scanned ${fixtureName}`,
        acquisitionStage: async (stage) => {
          if (stage === "waiting-for-pre-barrier-legacy") {
            currentWaiting.resolve();
          }
        },
      }).then((release) => {
        currentEntered = true;
        return release;
      });
      await currentWaiting.promise;
      assert.equal(
        currentEntered,
        false,
        "a published frozen contender remains a migration blocker after its scan",
      );
      resumeFrozen.resolve();
      const releaseFrozen = await frozen;
      await releaseFrozen();
      const releaseCurrent = await current;
      await releaseCurrent();
    });
  }

  for (const stage of [
    "owner-file-synced",
    "draft-directory-synced",
    "quiescence-probe-published",
    "quiescence-probe-retired",
    "legacy-quiescence-established",
    "gate-name-selected",
    "gate-parent-synced",
    "gate-legacy-rescanned",
    "state-renamed",
    "state-parent-synced",
  ]) {
    test(`a process crash after ${stage} is recoverable`, async () => {
      const caseRoot = path.join(temporary, `crash-${stage}`);
      const directory = path.join(caseRoot, "locks");
      const markers = path.join(caseRoot, "markers");
      await mkdir(markers, { recursive: true });
      const child = startCrashWorker(directory, markers, stage);
      await waitFor(path.join(markers, `crash-${stage}`));
      const alreadyExited = child.exitCode !== null || child.signalCode !== null;
      const exited = alreadyExited
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            child.once("error", reject);
            child.once("exit", () => resolve());
          });
      if (!alreadyExited) child.kill("SIGKILL");
      await exited;

      const release = await acquireProcessIntentLock({
        intentsDirectory: directory,
        label: `recover ${stage}`,
        timeoutMs: 2_000,
      });
      await release();
      const secondRelease = await acquireProcessIntentLock({
        intentsDirectory: directory,
        label: `finish recovery ${stage}`,
        timeoutMs: 2_000,
      });
      await secondRelease();
      const artifacts = await readdir(directory);
      assert.equal(
        artifacts.some((name) =>
          name.startsWith(".intent-") ||
          name.startsWith(".quiescence-") ||
          name.startsWith(".publisher") ||
          name.startsWith(".published-") ||
          /^\d{24}-\d+-[a-f0-9]{16}-[a-f0-9]+\.lock$/.test(name)
        ),
        false,
        `all ${stage} publication artifacts are retired`,
      );
    });
  }
}
