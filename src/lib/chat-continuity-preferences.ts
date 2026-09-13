export const CHAT_CONTINUITY_ENABLED_KEY = "cave.chat.continuity.enabled.v1";

export type ContinuityReference = {
  sourceId: string;
  familiarId: string;
  conversationId: string;
  anchorId: string | null;
};

export function parseContinuityReference(raw: string | null): ContinuityReference | null {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || !["sourceId", "familiarId", "conversationId"].every((key) => typeof value[key] === "string" && value[key].length > 0)) return null;
    if (value.anchorId !== null) {
      if (typeof value.anchorId !== "string") return null;
      const anchor = JSON.parse(value.anchorId);
      if (!Array.isArray(anchor) || anchor.length !== 3 || anchor[0] !== "utc-day-v1" || anchor[1] !== value.conversationId || typeof anchor[2] !== "string" || !anchor[2]) return null;
    }
    return { sourceId: value.sourceId, familiarId: value.familiarId, conversationId: value.conversationId, anchorId: value.anchorId };
  } catch {
    return null;
  }
}

export function resolveContinuityReturn(
  reference: ContinuityReference | null,
  sourceId: string,
  familiarId: string,
  sessions: readonly { id: string; familiarId?: string | null; archived_at?: string | null }[],
  explicitNavigation: boolean,
): string | null {
  if (explicitNavigation || reference?.sourceId !== sourceId || reference.familiarId !== familiarId) return null;
  const session = sessions.find((entry) => entry.id === reference.conversationId);
  return session?.familiarId === familiarId && !session.archived_at ? session.id : null;
}

/** A navigation namespace, not an authorization or familiar identity proof. */
export function continuitySourceId(instanceId: unknown, origin: string): string {
  if (typeof instanceId !== "string" || !instanceId.trim() || instanceId.length > 64 || !origin) return "";
  return JSON.stringify(["cave-instance-v1", origin, instanceId]);
}

export function matchesContinuitySource(
  payload: { sourceStamp?: string } | null | undefined,
  expectedSourceId: string | null,
  origin: string,
): boolean {
  if (!expectedSourceId || !payload?.sourceStamp) return false;
  try {
    return continuitySourceId(JSON.parse(decodeURIComponent(payload.sourceStamp)), origin) === expectedSourceId;
  } catch {
    return false;
  }
}

function referenceKey(sourceId: string, familiarId: string): string {
  return `cave.chat.continuity.return.v1:${JSON.stringify([sourceId, familiarId])}`;
}

export function readContinuityReference(sourceId: string, familiarId: string): ContinuityReference | null {
  if (!sourceId || typeof window === "undefined") return null;
  try {
    return parseContinuityReference(window.localStorage.getItem(referenceKey(sourceId, familiarId)));
  } catch {
    console.warn("Continuity preferences could not be read; automatic chat restoration is unavailable.");
    return null;
  }
}

export function writeContinuityReference(reference: ContinuityReference): void {
  if (typeof window === "undefined") return;
  try {
    const safe = parseContinuityReference(JSON.stringify(reference));
    if (safe) window.localStorage.setItem(referenceKey(safe.sourceId, safe.familiarId), JSON.stringify(safe));
  } catch {
    console.warn("Continuity preferences could not be saved; the current chat remains open.");
  }
}
