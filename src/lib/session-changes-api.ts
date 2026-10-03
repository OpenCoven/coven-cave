export type FileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

export type ChangedFile = {
  path: string;
  status: FileStatus;
  renamedFrom?: string;
  insertions?: number;
  deletions?: number;
  /** Filesystem stamp (mtime:ctime:size) the server attaches on each poll, so
   *  a rewrite that keeps the same diffstat still reads as a new version. */
  changeVersion?: string;
};

export type DiffState = {
  loading: boolean;
  /** The file version this diff was read for (`diffSignature`). A cached diff
   *  whose file has changed since is stale and is read again (#5745). */
  sig?: string;
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

/** A refused changes request. `stale` marks a refusal because the tree or
 *  the branch moved since it was reviewed (#5756). */
export class ChangesRequestError extends Error {
  readonly status: number;
  readonly stale: boolean;
  constructor(message: string, status: number, stale: boolean) {
    super(message);
    this.name = "ChangesRequestError";
    this.status = status;
    this.stale = stale;
  }
}

async function readChangesJson<T extends ChangesResponse>(res: Awaited<ReturnType<ChangesFetch>>): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as T & { stale?: unknown };
  if (!res.ok || !json.ok) throw new ChangesRequestError(json.error ?? `http ${res.status}`, res.status, json.stale === true);
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
