/**
 * Follow-up runs for the Coding Desk composer, kept per session outside React
 * (#5729).
 *
 * CodeView mounts one workbench, and so one composer, per session. A run
 * used to live in the composer's own state, so switching to another session
 * mid-reply orphaned it: coming back found Send enabled, Stop unreachable,
 * and the reply or a failure that landed while away was gone. The store keeps
 * each session's run (phase, streamed text, controller) for the life of the
 * page, and the composer subscribes with `useSyncExternalStore`.
 *
 * Every write names the run it belongs to: a late event from a superseded run
 * can never overwrite a newer one.
 */

export type CodeComposerRunPhase = "idle" | "streaming" | "done" | "error" | "stopped";

export type CodeComposerRun = {
  phase: CodeComposerRunPhase;
  runId: string | null;
  reply: string;
  message: string | null;
  /** Typed text to put back in the field (a failed or stopped ask with no answer). */
  restore: string | null;
};

export const IDLE_COMPOSER_RUN: CodeComposerRun = Object.freeze({
  phase: "idle",
  runId: null,
  reply: "",
  message: null,
  restore: null,
}) as CodeComposerRun;

export const CODE_COMPOSER_RUN_LIMIT = 24;

type Entry = { run: CodeComposerRun; controller: AbortController | null; stopped: boolean };

export function createComposerRunStore(limit = CODE_COMPOSER_RUN_LIMIT) {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const put = (sessionId: string, entry: Entry) => {
    entries.delete(sessionId);
    entries.set(sessionId, entry);
    while (entries.size > Math.max(1, limit)) {
      const oldest = [...entries].find(([, e]) => e.run.phase !== "streaming")?.[0];
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
    emit();
  };
  const current = (sessionId: string, runId: string) => {
    const entry = entries.get(sessionId);
    return entry && entry.run.runId === runId ? entry : null;
  };

  return {
    /** A stable snapshot: the same object until the session's run changes. */
    read(sessionId: string): CodeComposerRun {
      return entries.get(sessionId)?.run ?? IDLE_COMPOSER_RUN;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    begin(sessionId: string, runId: string, controller: AbortController): boolean {
      if (entries.get(sessionId)?.run.phase === "streaming") return false;
      put(sessionId, {
        run: { phase: "streaming", runId, reply: "", message: null, restore: null },
        controller,
        stopped: false,
      });
      return true;
    },
    reply(sessionId: string, runId: string, text: string): void {
      const entry = current(sessionId, runId);
      if (!entry || entry.run.phase !== "streaming" || entry.run.reply === text) return;
      put(sessionId, { ...entry, run: { ...entry.run, reply: text } });
    },
    /** Abort now; the run's own completion records the "stopped" outcome. */
    stop(sessionId: string): string | null {
      const entry = entries.get(sessionId);
      if (!entry || entry.run.phase !== "streaming") return null;
      entry.stopped = true;
      entry.controller?.abort();
      return entry.run.runId;
    },
    wasStopped(sessionId: string, runId: string): boolean {
      return current(sessionId, runId)?.stopped ?? false;
    },
    finish(sessionId: string, runId: string, patch: Pick<CodeComposerRun, "phase" | "reply" | "message" | "restore">): void {
      const entry = current(sessionId, runId);
      if (!entry) return;
      put(sessionId, { run: { ...entry.run, ...patch }, controller: null, stopped: entry.stopped });
    },
    /** The field took the restored text; don't offer it again. */
    ackRestore(sessionId: string): void {
      const entry = entries.get(sessionId);
      if (!entry || entry.run.restore === null) return;
      put(sessionId, { ...entry, run: { ...entry.run, restore: null } });
    },
  };
}

export type ComposerRunStore = ReturnType<typeof createComposerRunStore>;

/** The page's store. Module scope so a run outlives the composer that began it. */
export const composerRuns = createComposerRunStore();
