// /api/coven-status — aggregates familiar activity from the OpenClaw session
// index files at ~/.openclaw/agents/<id>/sessions/*.jsonl.
//
// Returns a CovenStatusResponse: one FamiliarCard per familiar with derived
// status, session summaries, and task label. Designed for the Coven Floor
// status board.

import { NextResponse } from "next/server";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import {
  deriveStatus,
  type CovenStatusResponse,
  type FamiliarCard,
  type SessionSummary,
} from "@/lib/coven-status-types";
import { DEMO_FAMILIARS, DEMO_MODE } from "@/lib/demo-seed";
import { isDemoModeRequest } from "@/lib/demo-mode";
import {
  initiatorFromOpenClawMessages,
  openClawMessagesFromJsonlLines,
} from "@/lib/session-initiator";

export const dynamic = "force-dynamic";

// ── Session file parsing ──────────────────────────────────────────────────────

/** First line of a .jsonl session file — the session header. */
type SessionHeader = {
  type: "session";
  version: number;
  id: string;
  timestamp: string; // ISO
  cwd?: string;
};

/** First matching trajectory event for session.started / session.ended. */
type TrajectoryEvent = {
  type: "session.started" | "session.ended" | "run.completed" | string;
  ts: string;
  sessionKey?: string;
  /** Populated for run.completed */
  status?: string;
  data?: {
    label?: string;
    taskName?: string;
    trigger?: string;
    exitReason?: string;
  };
};

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/** Read the first N bytes of a file and return lines. */
async function headLines(filePath: string, maxBytes = 4096): Promise<string[]> {
  try {
    const handle = await import("node:fs").then((fs) =>
      fs.promises.open(filePath, "r"),
    );
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buf, 0, maxBytes, 0);
    await handle.close();
    return buf.subarray(0, bytesRead).toString("utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Scan an agent's sessions directory and return summarised sessions from the
 * last 24 hours.
 */
async function scanAgentSessions(agentId: string, now: number): Promise<SessionSummary[]> {
  const agentsRoot = path.join(homedir(), ".openclaw", "agents");
  const sessionsDir = path.join(agentsRoot, agentId, "sessions");

  const resolved = path.resolve(sessionsDir);
  const rootResolved = path.resolve(agentsRoot);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    return [];
  }

  let entries: string[];
  try {
    entries = await readdir(sessionsDir);
  } catch {
    return [];
  }

  // Only consider .jsonl files (not .trajectory.jsonl, not .json)
  const sessionFiles = entries
    .filter((e) => e.endsWith(".jsonl") && !e.includes(".trajectory."))
    .map((e) => path.join(sessionsDir, e));

  const summaries: SessionSummary[] = [];

  for (const filePath of sessionFiles) {
    try {
      // Check mtime first — skip if clearly older than 24h
      const s = await stat(filePath);
      if (now - s.mtimeMs > TWENTY_FOUR_HOURS_MS * 2) continue;

      const lines = await headLines(filePath, 2048);
      if (lines.length === 0) continue;

      let header: SessionHeader | null = null;
      try {
        const parsed = JSON.parse(lines[0]) as Partial<SessionHeader>;
        if (parsed.type === "session" && parsed.id) {
          header = parsed as SessionHeader;
        }
      } catch {
        continue;
      }
      if (!header) continue;

      const sessionStartMs = new Date(header.timestamp).getTime();
      if (now - sessionStartMs > TWENTY_FOUR_HOURS_MS) continue;

      // Try to read the trajectory file for richer status + label
      const trajectoryPath = filePath.replace(".jsonl", ".trajectory.jsonl");
      const trajLines = await headLines(trajectoryPath, 8192);

      let status = "unknown";
      let label = "";
      let runtimeMs: number | undefined;
      let isSubagent = false;
      let parentId: string | undefined;
      let sessionKey = "";
      let model: string | undefined;
      let channel: string | undefined;
      let lastTs = header.timestamp;

      for (const line of trajLines) {
        try {
          const ev = JSON.parse(line) as TrajectoryEvent;
          if (ev.ts) lastTs = ev.ts;

          if (ev.type === "session.started") {
            status = "running";
            if (ev.sessionKey) sessionKey = ev.sessionKey;
            // Detect subagent from sessionKey pattern
            if (sessionKey.includes(":subagent:")) {
              isSubagent = true;
              // parent is the non-subagent portion — we don't know the exact
              // session id without scanning but that's OK for display
            }
          }
          if (ev.type === "session.ended") {
            status = "done";
            const task = ev.data?.taskName?.trim();
            const lbl = ev.data?.label?.trim();
            if (task) label = task;
            else if (lbl) label = lbl;
          }
          if (ev.type === "run.completed") {
            const task = ev.data?.taskName?.trim();
            const lbl = ev.data?.label?.trim();
            if (task) label = task;
            else if (lbl) label = lbl;

            const exitReason = ev.data?.exitReason ?? "";
            if (exitReason === "error" || exitReason === "exception") status = "failed";
            else if (exitReason === "timeout") status = "timeout";
            else status = "done";
          }
          if (ev.type === "trace.metadata") {
            const d = ev.data as Record<string, unknown> | undefined;
            if (d) {
              const modelId = (d as Record<string, string>)?.modelId;
              if (modelId) model = modelId;
              // channel from sessionKey
              if (ev.sessionKey) {
                const parts = ev.sessionKey.split(":");
                // agent:<id>:telegram:direct:xxx -> channel = telegram
                if (parts.length >= 3) channel = parts[2];
              }
            }
          }
        } catch {
          // skip malformed lines
        }
      }

      // Fallback label: extract from sessionKey
      if (!label && sessionKey) {
        // agent:<id>:cron:uuid -> "cron"
        // agent:<id>:telegram:direct:xxx -> "telegram"
        // agent:<id>:subagent:uuid -> "subagent"
        const parts = sessionKey.split(":");
        if (parts.length >= 3) {
          label = parts[2];
          if (parts[2] === "cron" && parts.length >= 4) label = `cron`;
          if (parts[2] === "subagent") {
            isSubagent = true;
            label = "subagent";
          }
        }
      }

      // Prefer the latest event timestamp we observed in the trajectory, but
      // never go older than the session file mtime.
      const lastEventMs = Date.parse(lastTs);
      const updatedAtMs = Number.isFinite(lastEventMs)
        ? Math.max(lastEventMs, s.mtimeMs)
        : s.mtimeMs;
      const updatedAt = new Date(updatedAtMs).toISOString();

      summaries.push({
        id: header.id,
        label: label || header.id.slice(0, 8),
        status,
        updatedAt,
        runtimeMs,
        isSubagent,
        parentId,
        model,
        channel,
        initiator: initiatorFromOpenClawMessages(
          openClawMessagesFromJsonlLines(lines),
          agentId,
          sessionKey,
        ),
      });
    } catch {
      // skip unreadable files
    }
  }

  // Sort newest first
  summaries.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  return summaries;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const now = Date.now();
  const demoMode = DEMO_MODE || isDemoModeRequest(req);

  // Build familiar ids from local agent directories. Demo defaults are opt-in
  // only so production installs show just the user's own familiars.
  const agentsRoot = path.join(homedir(), ".openclaw", "agents");
  let diskIds: string[] = [];
  try {
    const entries = await readdir(agentsRoot, { withFileTypes: true });
    diskIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    // ignore
  }

  const knownIds = demoMode ? DEMO_FAMILIARS.map((f) => f.id) : [];
  const familiarIds = Array.from(new Set([...diskIds, ...knownIds]));
  const familiarMeta = familiarIds.map((id) => ({
    id,
    display_name: id.charAt(0).toUpperCase() + id.slice(1),
    role: "familiar",
  }));

  // Scan sessions for each familiar in parallel
  const cards: FamiliarCard[] = await Promise.all(
    familiarMeta.map(async (f): Promise<FamiliarCard> => {
      const sessions = await scanAgentSessions(f.id, now);

      const status = deriveStatus(sessions, now);
      const runningCount = sessions.filter((s) => s.status === "running").length;
      const stuckCount = sessions.filter(
        (s) => s.status === "failed" || s.status === "timeout",
      ).length;

      // Current task: prefer running session label, then most recent
      const running = sessions.find((s) => s.status === "running");
      const currentTask = running?.label ?? sessions[0]?.label ?? null;

      const lastActiveAt = sessions[0]?.updatedAt ?? null;

      return {
        id: f.id,
        displayName: f.display_name,
        role: f.role,
        glyph: f.display_name.charAt(0).toUpperCase(),
        status,
        lastActiveAt,
        currentTask,
        sessions,
        runningCount,
        stuckCount,
      };
    }),
  );

  // Sort: active first, then stuck, then idle, then quiet
  const order: Record<string, number> = { active: 0, stuck: 1, idle: 2, quiet: 3 };
  cards.sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4));

  const response: CovenStatusResponse = {
    ok: true,
    familiars: cards,
    computedAt: new Date(now).toISOString(),
  };

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store" },
  });
}
