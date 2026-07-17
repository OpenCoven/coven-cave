import { readdir, readFile, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { familiarWorkspace } from "@/lib/coven-paths";
import { redactSecretsDeep } from "@/lib/secret-redaction";
import {
  isThreadMetricSnapshot,
  snapshotFromReport,
  type ThreadMetricSnapshot,
} from "@/lib/signal-trends";
import {
  type ThreadSelfReport,
} from "@/lib/thread-self-report";
import { isValidFamiliarId } from "./familiar-id";

export const SELF_REPORT_SESSION_ID_RE = /^[a-z0-9_-]+$/i;

function assertFamiliarId(familiarId: string) {
  if (!isValidFamiliarId(familiarId)) throw new Error("path not allowed");
}

function reportDate(report: ThreadSelfReport): string {
  const date = report.reportedAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
}

async function reportsDir(familiarId: string): Promise<string> {
  assertFamiliarId(familiarId);
  return path.join(await familiarWorkspace(familiarId), "self-reports");
}

/** Compact per-thread metric snapshots (signal trends) — kept in a
 *  subdirectory so the report reader's *.jsonl glob never sees them. */
async function metricSnapshotsDir(familiarId: string): Promise<string> {
  return path.join(await reportsDir(familiarId), "metric-snapshots");
}

function sortNewestFirst(a: ThreadSelfReport, b: ThreadSelfReport): number {
  return new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime();
}

async function readAllReports(familiarId: string): Promise<ThreadSelfReport[]> {
  const dir = await reportsDir(familiarId);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const reports: ThreadSelfReport[] = [];
  for (const file of files.filter((name) => name.endsWith(".jsonl")).sort()) {
    const fullPath = path.join(dir, file);
    let raw = "";
    try {
      raw = await readFile(fullPath, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        reports.push(redactSecretsDeep(JSON.parse(trimmed) as ThreadSelfReport));
      } catch {
        /* Ignore malformed historical lines; append-only storage should keep listing usable. */
      }
    }
  }
  return reports.sort(sortNewestFirst);
}

export async function appendSelfReport(familiarId: string, report: ThreadSelfReport): Promise<void> {
  const dir = await reportsDir(familiarId);
  await mkdir(dir, { recursive: true });
  const redacted = redactSecretsDeep(report);
  await appendFile(path.join(dir, `${reportDate(redacted)}.jsonl`), `${JSON.stringify(redacted)}\n`, "utf8");
  // Also persist the compact metric snapshot (signal trends). Additive:
  // readers backfill from full reports, so a failure here only costs a cache.
  try {
    const snapshotDir = await metricSnapshotsDir(familiarId);
    await mkdir(snapshotDir, { recursive: true });
    const snapshot = snapshotFromReport(redacted);
    await appendFile(
      path.join(snapshotDir, `${reportDate(redacted)}.jsonl`),
      `${JSON.stringify(snapshot)}\n`,
      "utf8",
    );
  } catch {
    /* Snapshot persistence is a derived convenience — never fail the report write. */
  }
}

async function readPersistedMetricSnapshots(familiarId: string): Promise<ThreadMetricSnapshot[]> {
  const dir = await metricSnapshotsDir(familiarId);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const snapshots: ThreadMetricSnapshot[] = [];
  for (const file of files.filter((name) => name.endsWith(".jsonl")).sort()) {
    let raw = "";
    try {
      raw = await readFile(path.join(dir, file), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isThreadMetricSnapshot(parsed)) snapshots.push(parsed);
      } catch {
        /* Ignore malformed historical lines; append-only storage should keep listing usable. */
      }
    }
  }
  return snapshots;
}

/**
 * All metric snapshots for a familiar, oldest → newest (the trend x-axis).
 * Reports that predate snapshot persistence are backfilled from the full
 * report store, so legacy data always loads; persisted rows win on id.
 */
export async function listMetricSnapshots(
  familiarId: string,
): Promise<{ snapshots: ThreadMetricSnapshot[]; total: number }> {
  const [persisted, reports] = await Promise.all([
    readPersistedMetricSnapshots(familiarId),
    readAllReports(familiarId),
  ]);
  const byId = new Map<string, ThreadMetricSnapshot>();
  // Append-only store: later lines are newer — on duplicate report ids
  // (replays, repairs, partial writes) the newest persisted line wins.
  for (const snapshot of persisted) {
    byId.set(snapshot.id, snapshot);
  }
  for (const report of reports) {
    if (!byId.has(report.id)) byId.set(report.id, snapshotFromReport(report));
  }
  const snapshots = [...byId.values()].sort(
    (a, b) => new Date(a.reportedAt).getTime() - new Date(b.reportedAt).getTime(),
  );
  return { snapshots, total: snapshots.length };
}

export async function listSelfReports(
  familiarId: string,
  opts: { limit?: number; before?: string },
): Promise<{ reports: ThreadSelfReport[]; total: number }> {
  const reports = await readAllReports(familiarId);
  const beforeMs = opts.before ? new Date(opts.before).getTime() : null;
  const filtered = Number.isFinite(beforeMs)
    ? reports.filter((report) => new Date(report.reportedAt).getTime() < (beforeMs as number))
    : reports;
  const limit = Math.max(0, Math.min(100, Math.floor(opts.limit ?? 20)));
  return { reports: filtered.slice(0, limit), total: filtered.length };
}

export async function findSelfReport(familiarId: string, sessionId: string): Promise<ThreadSelfReport | null> {
  assertFamiliarId(familiarId);
  if (!SELF_REPORT_SESSION_ID_RE.test(sessionId)) return null;
  const reports = await readAllReports(familiarId);
  return reports.find((report) => report.sessionId === sessionId) ?? null;
}
