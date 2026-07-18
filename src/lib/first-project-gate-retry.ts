import type { CaveProject } from "./cave-projects-types.ts";

export const FIRST_PROJECT_GATE_PENDING_KEY = "cave:first-project-access:pending:v1";
const FIRST_PROJECT_GATE_STORAGE_PROBE_KEY = "cave:first-project-access:probe:v1";

export type RegisteredProjectSnapshot = Pick<CaveProject, "id" | "name" | "root">;

export type PendingFirstProjectAccessSnapshot = {
  familiarId: string;
  project: RegisteredProjectSnapshot;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function readSessionStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parsePendingFirstProjectAccessSnapshot(raw: string | null): PendingFirstProjectAccessSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const familiarId = normalizeNonEmptyString((parsed as { familiarId?: unknown }).familiarId);
    const project = (parsed as { project?: unknown }).project;
    if (!familiarId || !project || typeof project !== "object" || Array.isArray(project)) return null;

    const id = normalizeNonEmptyString((project as { id?: unknown }).id);
    const name = normalizeNonEmptyString((project as { name?: unknown }).name);
    const root = normalizeNonEmptyString((project as { root?: unknown }).root);
    if (!id || !name || !root) return null;

    return {
      familiarId,
      project: { id, name, root },
    };
  } catch {
    return null;
  }
}

export function readPendingFirstProjectAccessSnapshot(
  storage?: StorageLike | null,
): PendingFirstProjectAccessSnapshot | null {
  const target = readSessionStorage(storage);
  if (!target) return null;
  try {
    return parsePendingFirstProjectAccessSnapshot(target.getItem(FIRST_PROJECT_GATE_PENDING_KEY));
  } catch {
    return null;
  }
}

export function writePendingFirstProjectAccessSnapshot(
  snapshot: PendingFirstProjectAccessSnapshot,
  storage?: StorageLike | null,
): boolean {
  const target = readSessionStorage(storage);
  if (!target) return false;
  try {
    target.setItem(FIRST_PROJECT_GATE_PENDING_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function canPersistPendingFirstProjectAccessSnapshot(storage?: StorageLike | null): boolean {
  const target = readSessionStorage(storage);
  if (!target) return false;
  try {
    target.setItem(FIRST_PROJECT_GATE_STORAGE_PROBE_KEY, "1");
    target.removeItem(FIRST_PROJECT_GATE_STORAGE_PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function clearPendingFirstProjectAccessSnapshot(storage?: StorageLike | null): void {
  const target = readSessionStorage(storage);
  if (!target) return;
  try {
    target.removeItem(FIRST_PROJECT_GATE_PENDING_KEY);
  } catch {
    // private mode / blocked storage — nothing to do
  }
}
