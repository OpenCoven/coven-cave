// /api/coven-status — aggregates familiar activity from the OpenClaw session
// index files at ~/.openclaw/agents/<id>/sessions/*.jsonl and the familiars
// list from the coven daemon.
//
// Returns a CovenStatusResponse: one FamiliarCard per familiar with derived
// status, session summaries, and task label. Designed for the Coven Floor
// status board.

import { NextResponse } from "next/server";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { callDaemon } from "@/lib/coven-daemon";
import {
  deriveStatus,
  type CovenStatusResponse,
  type FamiliarCard,
  type SessionSummary,
} from "@/lib/coven-status-types";

export const dynamic = "force-dynamic";

// ── Familiar metadata from daemon ────────────────────────────────────────────

type DaemonFamiliar = {
  id: string;
  display_name: string;
  role: string;
  emoji?: string;
  icon?: string;
};

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
  const sessionsDir = path.join(homedir(), ".openclaw", "agents", agentId, "sessions");
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
            if (ev.data?.label) label = ev.data.label;
          }
          if (ev.type === "run.completed") {
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
                // agent:kitty:telegram:direct:xxx → channel = telegram
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
        // agent:kitty:cron:uuid → "cron"
        // agent:kitty:telegram:direct:xxx → "telegram"
        // agent:kitty:subagent:uuid → "subagent"
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

      // Last seen from mtime
      const mtimeISO = new Date(s.mtimeMs).toISOString();

      summaries.push({
        id: header.id,
        label: label || header.id.slice(0, 8),
        status,
        updatedAt: mtimeISO,
        runtimeMs,
        isSubagent,
        parentId,
        model,
        channel,
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

export async function GET() {
  const now = Date.now();

  // Load familiars from daemon (non-fatal if daemon is down)
  const daemonRes = await callDaemon<DaemonFamiliar[]>({
    path: "/api/v1/familiars",
    timeoutMs: 3000,
  });

  // Fall back to a known set of familiar ids if daemon is unreachable
  const knownIds = ["kitty", "cody", "sage", "charm", "astra", "echo", "nova"];
  const daemonFamiliars: DaemonFamiliar[] = daemonRes.ok && daemonRes.data
    ? daemonRes.data
    : knownIds.map((id) => ({
        id,
        display_name: id.charAt(0).toUpperCase() + id.slice(1),
        role: "familiar",
      }));

  // Scan sessions for each familiar in parallel
  const cards: FamiliarCard[] = await Promise.all(
    daemonFamiliars.map(async (f): Promise<FamiliarCard> => {
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
        glyph: f.icon ?? f.emoji ?? f.display_name.charAt(0).toUpperCase(),
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
