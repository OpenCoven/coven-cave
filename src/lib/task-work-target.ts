type SessionIdentity = {
  id: string;
};

export type TaskWorkTarget<T extends SessionIdentity> =
  | { kind: "unlinked" }
  | { kind: "preparing"; sessionId: string }
  | { kind: "ready"; session: T };

export function resolveTaskWorkTarget<T extends SessionIdentity>(
  sessionId: string | null | undefined,
  sessions: readonly T[],
): TaskWorkTarget<T> {
  if (!sessionId) return { kind: "unlinked" };
  const session = sessions.find((candidate) => candidate.id === sessionId);
  return session
    ? { kind: "ready", session }
    : { kind: "preparing", sessionId };
}
