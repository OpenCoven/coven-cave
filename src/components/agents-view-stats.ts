import type { Familiar, SessionRow } from "@/lib/types";

export type CovenMemoryEntry = {
  id: string;
  familiar_id: string;
  title: string;
  path: string;
  updated_at: string;
  excerpt?: string;
  source_context?: string;
};

export type AgentCardStats = {
  memoryCount: number;
  latestMemory: { title: string; updatedAt: string } | null;
  lastSessionAt: string | null;
  sessionsLast7d: number;
  hasActiveSession: boolean;
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60_000;
const FIVE_MINUTES_MS = 5 * 60_000;

export function buildAgentCardStats(args: {
  familiars: Familiar[];
  sessions: SessionRow[];
  covenEntries: CovenMemoryEntry[];
  now?: number;
}): Map<string, AgentCardStats> {
  const now = args.now ?? Date.now();
  const sevenCutoff = now - SEVEN_DAYS_MS;
  const activeCutoff = now - FIVE_MINUTES_MS;

  const sessionsByFamiliar = new Map<string, SessionRow[]>();
  for (const session of args.sessions) {
    const fid = session.familiarId;
    if (!fid) continue;
    const bucket = sessionsByFamiliar.get(fid) ?? [];
    bucket.push(session);
    sessionsByFamiliar.set(fid, bucket);
  }

  const memoriesByFamiliar = new Map<string, CovenMemoryEntry[]>();
  for (const entry of args.covenEntries) {
    const bucket = memoriesByFamiliar.get(entry.familiar_id) ?? [];
    bucket.push(entry);
    memoriesByFamiliar.set(entry.familiar_id, bucket);
  }

  const result = new Map<string, AgentCardStats>();
  for (const familiar of args.familiars) {
    const sessions = sessionsByFamiliar.get(familiar.id) ?? [];
    const memories = memoriesByFamiliar.get(familiar.id) ?? [];

    let lastSessionAt: string | null = null;
    let lastSessionMs = -Infinity;
    let sessionsLast7d = 0;
    let hasActiveSession = false;
    for (const session of sessions) {
      const ms = Date.parse(session.updated_at);
      if (!Number.isFinite(ms)) continue;
      if (ms > lastSessionMs) {
        lastSessionMs = ms;
        lastSessionAt = session.updated_at;
      }
      if (ms > sevenCutoff) sessionsLast7d += 1;
      if (ms > activeCutoff) hasActiveSession = true;
    }

    let latestMemory: AgentCardStats["latestMemory"] = null;
    let latestMs = -Infinity;
    for (const entry of memories) {
      const ms = Date.parse(entry.updated_at);
      if (!Number.isFinite(ms)) continue;
      if (ms > latestMs) {
        latestMs = ms;
        latestMemory = { title: entry.title, updatedAt: entry.updated_at };
      }
    }

    result.set(familiar.id, {
      memoryCount: memories.length,
      latestMemory,
      lastSessionAt,
      sessionsLast7d,
      hasActiveSession,
    });
  }
  return result;
}
