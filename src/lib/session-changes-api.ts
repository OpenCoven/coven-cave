export type FileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

export type ChangedFile = {
  path: string;
  status: FileStatus;
  renamedFrom?: string;
  insertions?: number;
  deletions?: number;
};

export type DiffState = {
  loading: boolean;
  diff?: string;
  truncated?: boolean;
  error?: string;
};

export type CheckpointMeta = { name: string; savedAt: string; bytes: number };

type ChangesResponse = { ok?: boolean; error?: string };

export type ChangesFetch = (input: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

function changesUrl(projectRoot: string, params: Record<string, string> = {}) {
  const search = new URLSearchParams({ projectRoot, ...params });
  return `/api/changes?${search}`;
}

async function readChangesJson<T extends ChangesResponse>(res: Awaited<ReturnType<ChangesFetch>>): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok || !json.ok) throw new Error(json.error ?? `http ${res.status}`);
  return json;
}

/** Read saved snapshots without coupling the panel to transport details. */
export async function fetchSessionCheckpoints(fetchImpl: ChangesFetch, projectRoot: string): Promise<CheckpointMeta[]> {
  const res = await fetchImpl(changesUrl(projectRoot, { checkpoints: "1" }), { cache: "no-store" });
  const json = await readChangesJson<{ ok?: boolean; checkpoints?: CheckpointMeta[]; error?: string }>(res);
  return json.checkpoints ?? [];
}

/** Fetch a single file diff, retaining the route's truncation contract. */
export async function fetchSessionFileDiff(
  fetchImpl: ChangesFetch,
  projectRoot: string,
  filePath: string,
): Promise<{ diff: string; truncated?: boolean }> {
  const res = await fetchImpl(changesUrl(projectRoot, { path: filePath }), { cache: "no-store" });
  const json = await readChangesJson<{ ok?: boolean; diff?: string; truncated?: boolean; error?: string }>(res);
  return { diff: json.diff ?? "", truncated: json.truncated };
}

/** Post a mutation to the changes route and consistently surface route errors. */
export async function mutateSessionChanges<T extends ChangesResponse>(
  fetchImpl: ChangesFetch,
  projectRoot: string,
  action: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetchImpl("/api/changes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectRoot, action, ...body }),
  });
  return readChangesJson<T>(res);
}
