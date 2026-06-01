import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

import {
  RESOLVED_EXPIRY_MS,
  type Escalation,
  type EscalationOrigin,
  type EscalationSeverity,
  type EscalationState,
  type EscalationAction,
} from "@/lib/vals-inbox-types";

export {
  RESOLVED_EXPIRY_MS,
  SEVERITIES,
  ESCALATION_STATES,
  SNOOZE_PRESETS,
  type Escalation,
  type EscalationOrigin,
  type EscalationSeverity,
  type EscalationState,
  type EscalationAction,
  type SnoozePresetId,
  snoozePresetToTimestamp,
  sortEscalations,
} from "@/lib/vals-inbox-types";

const FILE_PATH = path.join(homedir(), ".coven", "vals-inbox.json");

type ValsInboxFile = {
  version: number;
  items: Escalation[];
};

const EMPTY: ValsInboxFile = { version: 1, items: [] };

async function ensureDir() {
  await mkdir(path.dirname(FILE_PATH), { recursive: true });
}

export async function loadValsInbox(): Promise<ValsInboxFile> {
  try {
    const raw = await readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<ValsInboxFile>;
    return {
      version: parsed.version ?? 1,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return EMPTY;
  }
}

async function saveValsInbox(file: ValsInboxFile): Promise<void> {
  await ensureDir();
  await writeFile(FILE_PATH, JSON.stringify(file, null, 2), "utf8");
}

export type NewEscalationInput = {
  title: string;
  origin: EscalationOrigin;
  severity?: EscalationSeverity;
  severityReason?: string;
  excerpt?: string;
  sourceSessionKey?: string;
  sourceUrl?: string;
  fromFamiliar?: string;
  aboutFamiliar?: string;
  decisionRequired?: boolean;
  actions?: EscalationAction[];
  metadata?: Record<string, unknown>;
};

export async function createEscalation(
  input: NewEscalationInput,
): Promise<Escalation> {
  if (!input.title.trim()) throw new Error("title required");
  const severity: EscalationSeverity = input.severity ?? "info";
  if (severity === "critical" && !input.severityReason?.trim()) {
    // Spec section 3.2: critical severity requires non-empty severityReason
    // when a familiar self-tags. We enforce on the boundary.
    throw new Error("severityReason required for critical");
  }
  const file = await loadValsInbox();
  const now = new Date().toISOString();
  const item: Escalation = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    origin: input.origin,
    sourceSessionKey: input.sourceSessionKey,
    sourceUrl: input.sourceUrl,
    fromFamiliar: input.fromFamiliar,
    aboutFamiliar: input.aboutFamiliar,
    title: input.title.trim(),
    excerpt: input.excerpt?.trim() || undefined,
    severity,
    severityReason: input.severityReason?.trim() || undefined,
    state: "new",
    decisionRequired: !!input.decisionRequired,
    actions: input.actions,
    metadata: input.metadata,
  };
  file.items.push(item);
  await saveValsInbox(file);
  return item;
}

export type EscalationPatch = {
  state?: EscalationState;
  snoozeUntil?: string;
  severity?: EscalationSeverity;
  severityReason?: string;
};

export async function patchEscalation(
  id: string,
  patch: EscalationPatch,
): Promise<Escalation | null> {
  const file = await loadValsInbox();
  const idx = file.items.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const current = file.items[idx];
  const now = new Date().toISOString();
  const next: Escalation = {
    ...current,
    ...patch,
    updatedAt: now,
  };
  if (patch.state === "resolved") {
    next.resolvedAt = now;
    next.snoozeUntil = undefined;
  }
  if (patch.state === "snoozed" && !patch.snoozeUntil) {
    throw new Error("snoozeUntil required when state=snoozed");
  }
  if (patch.state && patch.state !== "snoozed") {
    next.snoozeUntil = undefined;
  }
  file.items[idx] = next;
  await saveValsInbox(file);
  return next;
}

/**
 * Apply the 30-day rolling expiry to resolved items and wake snoozed items
 * whose `snoozeUntil` has passed. Returns the cleaned set without mutating
 * the underlying file unless something actually changed (avoids constant
 * writes from heartbeats hitting the read path).
 */
export async function reconcileValsInbox(now = new Date()): Promise<Escalation[]> {
  const file = await loadValsInbox();
  let dirty = false;
  const cutoff = now.getTime() - RESOLVED_EXPIRY_MS;
  const nowIso = now.toISOString();
  const cleaned: Escalation[] = [];
  for (const item of file.items) {
    if (item.state === "resolved" && item.resolvedAt) {
      if (new Date(item.resolvedAt).getTime() < cutoff) {
        dirty = true;
        continue;
      }
    }
    if (
      item.state === "snoozed" &&
      item.snoozeUntil &&
      new Date(item.snoozeUntil).getTime() <= now.getTime()
    ) {
      cleaned.push({ ...item, state: "new", snoozeUntil: undefined, updatedAt: nowIso });
      dirty = true;
      continue;
    }
    cleaned.push(item);
  }
  if (dirty) {
    await saveValsInbox({ ...file, items: cleaned });
  }
  return cleaned;
}

export { FILE_PATH as VALS_INBOX_PATH };
