import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { caveHome } from "../coven-paths.ts";
import {
  serializeResearchRunCompletionReceipt,
  validateResearchRunCompletionReceipt,
  verifyResearchRunCompletionReceipt,
  type ResearchRunCompletionReceiptV1,
} from "../research-run-authority-receipt.ts";
import { writeFileAtomic } from "./atomic-write.ts";

const RUN_ID_RE = /^run_[A-Za-z0-9_-]+$/;

function receiptRoot(override?: string): string {
  const configured = override?.trim() || process.env.COVEN_RESEARCH_RUN_RECEIPTS_DIR?.trim();
  return path.resolve(configured || path.join(caveHome(), "research-run-receipts"));
}

function receiptPath(runId: string, root?: string): string {
  if (!RUN_ID_RE.test(runId)) throw new TypeError("runId must be a canonical ResearchRun id");
  return path.join(receiptRoot(root), `${runId}.json`);
}

export function researchRunCompletionReceiptsRoot(override?: string): string {
  return receiptRoot(override);
}

export function researchRunCompletionReceiptPath(runId: string, root?: string): string {
  return receiptPath(runId, root);
}

/** Persist one validated receipt using a same-directory atomic replacement. */
export async function saveResearchRunCompletionReceipt(
  receipt: ResearchRunCompletionReceiptV1,
  root?: string,
): Promise<void> {
  const validated = validateResearchRunCompletionReceipt(receipt);
  if (!verifyResearchRunCompletionReceipt(validated)) {
    throw new TypeError("completion receipt integrity digest does not match its contents");
  }
  const target = receiptPath(validated.runId, root);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFileAtomic(target, serializeResearchRunCompletionReceipt(validated));
}

export async function loadResearchRunCompletionReceipt(
  runId: string,
  root?: string,
): Promise<ResearchRunCompletionReceiptV1 | null> {
  const target = receiptPath(runId, root);
  let raw: string;
  try {
    raw = await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Research run completion receipt is malformed JSON");
  }
  const receipt = validateResearchRunCompletionReceipt(value);
  if (receipt.runId !== runId || !verifyResearchRunCompletionReceipt(receipt)) {
    throw new Error("Research run completion receipt failed integrity validation");
  }
  return receipt;
}
