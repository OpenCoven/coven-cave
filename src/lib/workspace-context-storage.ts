const PROJECT_SCOPE_KEY = "cave:workspace:project-scope:v1";
const CREW_BY_PROJECT_KEY = "cave:workspace:familiar-scope-by-project:v1";
const ALL_PROJECTS_KEY = "__all-projects__";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PersistedWorkspaceContext = { projectId: string | null; familiarIds: string[] };

function normalizedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.sort();
}

function parseStoredJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid ${label} JSON`, { cause: error });
  }
}

function contextKey(projectId: string | null): string {
  return projectId ?? ALL_PROJECTS_KEY;
}

function parseProjectScope(raw: string): string | null {
  const parsed = parseStoredJson(raw, "workspace project scope");
  if (parsed !== null && (typeof parsed !== "string" || !parsed.trim())) {
    throw new Error("Invalid workspace project scope");
  }
  return typeof parsed === "string" ? parsed.trim() : null;
}

function parseCrewMap(raw: string): Record<string, string[]> {
  const parsed = parseStoredJson(raw, "workspace crew map");
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid workspace crew map");
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      throw new Error(`Invalid workspace crew map entry for ${key}`);
    }
  }
  return parsed as Record<string, string[]>;
}

export function readWorkspaceCrew(storage: StorageLike, projectId: string | null): string[] | null {
  const raw = storage.getItem(CREW_BY_PROJECT_KEY);
  if (raw === null) return null;
  const map = parseCrewMap(raw);
  const key = contextKey(projectId);
  if (!Object.prototype.hasOwnProperty.call(map, key)) return null;
  return normalizedIds(map[key]);
}

export function readWorkspaceContext(
  storage: StorageLike,
  legacyFamiliarIds: readonly string[],
): PersistedWorkspaceContext {
  const rawProject = storage.getItem(PROJECT_SCOPE_KEY);
  let projectId: string | null = null;
  if (rawProject !== null) {
    projectId = parseProjectScope(rawProject);
  }

  const crew = readWorkspaceCrew(storage, projectId);
  const familiarIds = crew !== null ? crew : normalizedIds([...legacyFamiliarIds]);
  return { projectId, familiarIds };
}

export function writeWorkspaceContext(storage: StorageLike, value: PersistedWorkspaceContext): void {
  const { projectId, familiarIds } = value;
  const normalizedProject = typeof projectId === "string" && projectId.trim() ? projectId.trim() : null;
  const normalizedCrew = normalizedIds(familiarIds);

  const rawProject = storage.getItem(PROJECT_SCOPE_KEY);
  if (rawProject !== null) {
    parseProjectScope(rawProject);
  }

  const rawMap = storage.getItem(CREW_BY_PROJECT_KEY);
  let existing: Record<string, unknown> = {};
  if (rawMap !== null) {
    existing = { ...parseCrewMap(rawMap) };
  }

  existing[contextKey(normalizedProject)] = normalizedCrew;
  storage.setItem(CREW_BY_PROJECT_KEY, JSON.stringify(existing));
  storage.setItem(PROJECT_SCOPE_KEY, JSON.stringify(normalizedProject));
}

export function browserWorkspaceStorage(): StorageLike | null {
  try {
    const ls = typeof window !== "undefined" && window.localStorage;
    return ls || null;
  } catch {
    return null;
  }
}
