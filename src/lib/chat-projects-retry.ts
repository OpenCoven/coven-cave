export type ProjectsRetryRoute = {
  sessionId: string | null;
  familiarId: string;
  projectRoot: string;
  composerDraftKey: string;
  composeId: string;
  runtimeHost?: string | null;
};

type RetryTarget = { familiarId: string; chatId: string };

/** One in-memory Projects round trip; never serializes a refused payload. */
export function createProjectsRetryCarry<T>() {
  let carried: { target: RetryTarget; payload: T } | null = null;
  return {
    save(target: RetryTarget, payload: T) {
      carried = { target: { ...target }, payload };
    },
    returnTo(target: RetryTarget): T | null {
      if (carried && (carried.target.familiarId !== target.familiarId || carried.target.chatId !== target.chatId)) {
        carried = null;
      }
      return carried?.payload ?? null;
    },
    read(target: RetryTarget): T | null {
      return carried?.target.familiarId === target.familiarId && carried.target.chatId === target.chatId
        ? carried.payload : null;
    },
    peek(): T | null { return carried?.payload ?? null; },
    drop() { carried = null; },
  };
}
