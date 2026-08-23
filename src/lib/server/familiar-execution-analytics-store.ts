import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "../coven-paths.ts";
import {
  executionAttemptLedgerRecord,
  normalizeExecutionAttemptLedgerRecord,
  normalizeExecutionAttemptSnapshot,
  type ExecutionAttemptSnapshotV1,
} from "../familiars/familiar-execution-analytics.ts";
import { isValidFamiliarId } from "./familiar-id.ts";

function ledgerDir(): string {
  return path.join(caveHome(), "familiar-execution-analytics", "v1");
}

function ledgerFile(familiarId: string): string {
  if (!isValidFamiliarId(familiarId)) throw new Error("path not allowed");
  return path.join(ledgerDir(), `${familiarId}.jsonl`);
}

export function serializeExecutionAttemptLedgerRecord(
  snapshot: ExecutionAttemptSnapshotV1,
): string | null {
  const normalized = normalizeExecutionAttemptSnapshot(snapshot);
  return normalized
    ? JSON.stringify(executionAttemptLedgerRecord(normalized))
    : null;
}

export async function listExecutionAttemptSnapshots(
  familiarId: string,
): Promise<ExecutionAttemptSnapshotV1[]> {
  const file = ledgerFile(familiarId);
  let raw = "";
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const byId = new Map<string, ExecutionAttemptSnapshotV1>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = normalizeExecutionAttemptLedgerRecord(JSON.parse(trimmed));
      if (!record || record.snapshot.familiarId !== familiarId) continue;
      byId.set(record.snapshot.attemptId, record.snapshot);
    } catch {
      // An append-only ledger remains readable when one historical line is bad.
    }
  }
  return [...byId.values()].sort((a, b) => (
    Date.parse(b.timing.completedAt) - Date.parse(a.timing.completedAt) ||
    a.attemptId.localeCompare(b.attemptId)
  ));
}

export async function appendExecutionAttemptSnapshots(
  familiarId: string,
  snapshots: ExecutionAttemptSnapshotV1[],
): Promise<number> {
  ledgerFile(familiarId);
  const existing = new Map(
    (await listExecutionAttemptSnapshots(familiarId))
      .map((snapshot) => [snapshot.attemptId, JSON.stringify(snapshot)]),
  );
  const lines: string[] = [];
  for (const snapshot of snapshots) {
    const normalized = normalizeExecutionAttemptSnapshot(snapshot);
    if (!normalized || normalized.familiarId !== familiarId) continue;
    const serializedSnapshot = JSON.stringify(normalized);
    if (existing.get(normalized.attemptId) === serializedSnapshot) continue;
    const line = serializeExecutionAttemptLedgerRecord(normalized);
    if (line) {
      lines.push(line);
      existing.set(normalized.attemptId, serializedSnapshot);
    }
  }
  if (!lines.length) return 0;
  await mkdir(ledgerDir(), { recursive: true });
  await appendFile(ledgerFile(familiarId), `${lines.join("\n")}\n`, "utf8");
  return lines.length;
}
