// Coven Calls store (issue #21) — appended to by the daemon when one
// familiar delegates to another. Cave reads and surfaces the events.
// Pure types + aggregator live in coven-calls-types so client code
// can import without pulling in node:fs.

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { writeJsonAtomic } from "./server/atomic-write.ts";
import { randomUUID } from "node:crypto";

import type {
  CovenCall,
  CovenCallInput,
} from "@/lib/coven-calls-types";

export type {
  CallStatus,
  CovenCall,
  CovenCallInput,
  CallEdge,
} from "@/lib/coven-calls-types";
export { aggregateEdges } from "@/lib/coven-calls-types";

const FILE_PATH = path.join(homedir(), ".coven", "cave-coven-calls.json");

type CallsFile = {
  version: number;
  calls: CovenCall[];
};

const EMPTY: CallsFile = { version: 1, calls: [] };

async function ensureDir() {
  await mkdir(path.dirname(FILE_PATH), { recursive: true });
}

export async function loadCalls(): Promise<CallsFile> {
  try {
    const raw = await readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<CallsFile>;
    return {
      version: parsed.version ?? 1,
      calls: Array.isArray(parsed.calls) ? parsed.calls : [],
    };
  } catch {
    return EMPTY;
  }
}

export async function saveCalls(file: CallsFile): Promise<void> {
  await ensureDir();
  await writeJsonAtomic(FILE_PATH, file);
}

export async function recordCall(input: CovenCallInput): Promise<CovenCall> {
  const file = await loadCalls();
  const call: CovenCall = {
    id: randomUUID(),
    callerFamiliarId: input.callerFamiliarId,
    calleeFamiliarId: input.calleeFamiliarId,
    request: input.request,
    status: "running",
    createdAt: new Date().toISOString(),
    sessionId: input.sessionId,
  };
  file.calls.push(call);
  await saveCalls(file);
  return call;
}

export async function completeCall(
  id: string,
  artifact?: string,
): Promise<CovenCall | null> {
  const file = await loadCalls();
  const call = file.calls.find((c) => c.id === id);
  if (!call) return null;
  call.status = "completed";
  call.endedAt = new Date().toISOString();
  if (artifact) call.artifact = artifact;
  await saveCalls(file);
  return call;
}
