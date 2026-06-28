import { readdir, readFile, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { familiarWorkspace } from "@/lib/coven-paths";
import { redactSecretsDeep } from "@/lib/secret-redaction";
import {
  normalizeResponseConfidenceEvent,
  type ResponseConfidenceEvent,
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

function eventDate(event: ResponseConfidenceEvent): string {
  const date = event.reportedAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
}

async function reportsDir(familiarId: string): Promise<string> {
  assertFamiliarId(familiarId);
  return path.join(await familiarWorkspace(familiarId), "self-reports");
}

async function responseConfidenceDir(familiarId: string): Promise<string> {
  return path.join(await reportsDir(familiarId), "response-confidence");
}

function sortNewestFirst(a: ThreadSelfReport, b: ThreadSelfReport): number {
  return new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime();
}

function sortEventsNewestFirst(a: ResponseConfidenceEvent, b: ResponseConfidenceEvent): number {
  return new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime();
}

function normalizeListLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(500, Math.floor(value)));
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

async function readAllResponseConfidenceEvents(familiarId: string): Promise<ResponseConfidenceEvent[]> {
  const dir = await responseConfidenceDir(familiarId);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const events: ResponseConfidenceEvent[] = [];
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
        events.push(normalizeResponseConfidenceEvent(redactSecretsDeep(JSON.parse(trimmed) as ResponseConfidenceEvent)));
      } catch {
        /* Ignore malformed historical lines; append-only storage should keep listing usable. */
      }
    }
  }
  return events.sort(sortEventsNewestFirst);
}

export async function appendSelfReport(familiarId: string, report: ThreadSelfReport): Promise<void> {
  const dir = await reportsDir(familiarId);
  await mkdir(dir, { recursive: true });
  const redacted = redactSecretsDeep(report);
  await appendFile(path.join(dir, `${reportDate(redacted)}.jsonl`), `${JSON.stringify(redacted)}\n`, "utf8");
}

export async function appendResponseConfidenceEvent(
  familiarId: string,
  event: ResponseConfidenceEvent,
): Promise<void> {
  const dir = await responseConfidenceDir(familiarId);
  await mkdir(dir, { recursive: true });
  const redacted = normalizeResponseConfidenceEvent(redactSecretsDeep(event));
  await appendFile(path.join(dir, `${eventDate(redacted)}.jsonl`), `${JSON.stringify(redacted)}\n`, "utf8");
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

export async function listResponseConfidenceEvents(
  familiarId: string,
  opts: { limit?: number; before?: string },
): Promise<{ events: ResponseConfidenceEvent[]; total: number }> {
  const events = await readAllResponseConfidenceEvents(familiarId);
  const beforeMs = opts.before ? new Date(opts.before).getTime() : null;
  const filtered = Number.isFinite(beforeMs)
    ? events.filter((event) => new Date(event.reportedAt).getTime() < (beforeMs as number))
    : events;
  const limit = normalizeListLimit(opts.limit, 100);
  return { events: filtered.slice(0, limit), total: filtered.length };
}

export async function findSelfReport(familiarId: string, sessionId: string): Promise<ThreadSelfReport | null> {
  assertFamiliarId(familiarId);
  if (!SELF_REPORT_SESSION_ID_RE.test(sessionId)) return null;
  const reports = await readAllReports(familiarId);
  return reports.find((report) => report.sessionId === sessionId) ?? null;
}
