"use client";

/**
 * use-review-source — what the Review Deck is actually showing you.
 *
 * The review source is decided by the session, never by which fetch resolved
 * first: a session with a linked pull request is reviewed through
 * `/api/github/diff`, and only a session with no pull request falls back to its
 * project's uncommitted work (`/api/changes`). That rule is the reason this
 * hook exists — the previous deck always read the working tree, so a reviewer
 * could approve a pull request while looking at a local diff that had nothing
 * to do with it.
 *
 * A pull-request read is one request: GitHub returns every file's patch inline,
 * bounded server-side. A local read is two — the file list, then one diff per
 * file on demand — because `/api/changes` has no bulk patch mode.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createReviewRequestGate } from "./review-deck";

export type ReviewSourceKind = "pull-request" | "local" | "none";

export type ReviewFileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

export type ReviewFile = {
  path: string;
  status: ReviewFileStatus;
  additions: number;
  deletions: number;
  /**
   * The unified diff, when the source carries it eagerly (pull requests).
   * `null` in local mode until the file is opened, and permanently null for a
   * file GitHub returned no patch for.
   */
  patch: string | null;
  /** Why there is no patch, when there is none to fetch. */
  noPatchReason: "github" | "budget" | null;
};

export type SourcePhase = "idle" | "loading" | "ready" | "error";

export type OpenPatch = {
  phase: SourcePhase;
  text: string | null;
  truncated: boolean;
  error: string | null;
};

export type ReviewSource = {
  kind: ReviewSourceKind;
  phase: SourcePhase;
  error: string | null;
  files: ReviewFile[];
  /** How many changed files the source actually carries. */
  filesShown: number;
  /** How many the change has in total — larger than `filesShown` when capped. */
  filesTotal: number;
  /** True when any patch was sliced or any file dropped. */
  truncated: boolean;
  /** Branch the local working tree is on; null in pull-request mode. */
  localBranch: string | null;
  openPath: string | null;
  openPatch: OpenPatch;
  open: (path: string) => void;
  retry: () => void;
};

type DiffWire = {
  ok?: boolean;
  truncated?: boolean;
  total?: number;
  files?: Array<{
    filename?: string;
    status?: string;
    additions?: number;
    deletions?: number;
    patch?: string | null;
    noPatchReason?: "github" | "budget" | null;
  }>;
};

type ChangesWire =
  | {
      ok: true;
      repo: true;
      repoRoot: string;
      branch: string | null;
      worktree: string | null;
      files: Array<{ path?: string; status?: string; insertions?: number; deletions?: number }>;
    }
  | { ok: true; repo: false; error?: string };

const STATUSES: readonly ReviewFileStatus[] = ["modified", "added", "deleted", "renamed", "untracked"];

/**
 * GitHub's pull-request file statuses are `added`, `removed`, `modified`,
 * `renamed`, `copied`, `changed`, and `unchanged` — only some of which match
 * ours. `removed` is the one that matters: git says "deleted", GitHub says
 * "removed", and falling through to the default painted every deleted file in
 * a pull request as modified.
 */
const GITHUB_STATUS: Record<string, ReviewFileStatus> = {
  removed: "deleted",
  copied: "added",
  changed: "modified",
  unchanged: "modified",
};

function fileStatus(raw: unknown): ReviewFileStatus {
  const value = typeof raw === "string" ? raw : "";
  if ((STATUSES as readonly string[]).includes(value)) return value as ReviewFileStatus;
  return GITHUB_STATUS[value] ?? "modified";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

const IDLE_PATCH: OpenPatch = { phase: "idle", text: null, truncated: false, error: null };

export function useReviewSource(input: {
  pr: { repo: string; number: number } | null;
  projectRoot: string | null;
  /** Changes whenever the selected session changes, invalidating in-flight reads. */
  scope: string;
}): ReviewSource {
  const { pr, projectRoot, scope } = input;
  const kind: ReviewSourceKind = pr ? "pull-request" : projectRoot ? "local" : "none";

  const [phase, setPhase] = useState<SourcePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [filesTotal, setFilesTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [localBranch, setLocalBranch] = useState<string | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [openPatch, setOpenPatch] = useState<OpenPatch>(IDLE_PATCH);

  const latestScope = useRef(scope);
  latestScope.current = scope;
  const listGate = useRef(createReviewRequestGate());
  const patchGate = useRef(createReviewRequestGate());

  const repo = pr?.repo ?? null;
  const number = pr?.number ?? null;

  const loadList = useCallback(async () => {
    const request = listGate.current.begin(scope);
    patchGate.current.invalidate();
    setFiles([]);
    setFilesTotal(0);
    setTruncated(false);
    setLocalBranch(null);
    setOpenPath(null);
    setOpenPatch(IDLE_PATCH);
    setError(null);

    if (!repo && !projectRoot) {
      setPhase("idle");
      return;
    }
    setPhase("loading");

    try {
      if (repo && number != null) {
        const res = await fetch(
          `/api/github/diff?repo=${encodeURIComponent(repo)}&number=${encodeURIComponent(String(number))}`,
          { cache: "no-store" },
        );
        const json = (await res.json().catch(() => null)) as DiffWire | null;
        if (!listGate.current.isCurrent(request, latestScope.current)) return;
        if (!json?.ok || !Array.isArray(json.files)) throw new Error("bad response");
        const parsed: ReviewFile[] = json.files.map((file) => ({
          path: typeof file.filename === "string" ? file.filename : "",
          status: fileStatus(file.status),
          additions: num(file.additions),
          deletions: num(file.deletions),
          patch: typeof file.patch === "string" ? file.patch : null,
          noPatchReason: file.noPatchReason ?? (typeof file.patch === "string" ? null : "github"),
        }));
        setFiles(parsed);
        setFilesTotal(typeof json.total === "number" ? json.total : parsed.length);
        setTruncated(json.truncated === true);
        setPhase("ready");
        return;
      }

      const res = await fetch(`/api/changes?projectRoot=${encodeURIComponent(projectRoot as string)}`, {
        cache: "no-store",
      });
      const json = res.ok ? ((await res.json()) as ChangesWire) : null;
      if (!listGate.current.isCurrent(request, latestScope.current)) return;
      if (!json?.ok) throw new Error("bad response");
      if (!json.repo) {
        setFiles([]);
        setFilesTotal(0);
        setPhase("ready");
        return;
      }
      const parsed: ReviewFile[] = json.files.map((file) => ({
        path: typeof file.path === "string" ? file.path : "",
        status: fileStatus(file.status),
        additions: num(file.insertions),
        deletions: num(file.deletions),
        patch: null,
        noPatchReason: null,
      }));
      setFiles(parsed);
      setFilesTotal(parsed.length);
      setLocalBranch(json.branch);
      setPhase("ready");
    } catch {
      if (!listGate.current.isCurrent(request, latestScope.current)) return;
      setPhase("error");
      setError(
        repo
          ? `Couldn't read the pull request diff for ${repo}#${number}.`
          : "Couldn't read this project's working tree.",
      );
    }
  }, [repo, number, projectRoot, scope]);

  useEffect(() => {
    void loadList();
    return () => {
      listGate.current.invalidate();
      patchGate.current.invalidate();
    };
  }, [loadList]);

  const open = useCallback(
    (path: string) => {
      setOpenPath(path);
      const file = files.find((candidate) => candidate.path === path) ?? null;

      // Pull-request patches arrived with the list — nothing to fetch, and a
      // file GitHub gave no patch for never will have one.
      if (kind === "pull-request" || file?.noPatchReason != null) {
        patchGate.current.invalidate();
        setOpenPatch({ phase: "ready", text: file?.patch ?? null, truncated: false, error: null });
        return;
      }
      if (!projectRoot) return;

      const request = patchGate.current.begin(`${scope}:${path}`);
      setOpenPatch({ phase: "loading", text: null, truncated: false, error: null });
      void (async () => {
        try {
          const res = await fetch(
            `/api/changes?projectRoot=${encodeURIComponent(projectRoot)}&path=${encodeURIComponent(path)}`,
            { cache: "no-store" },
          );
          const json = res.ok
            ? ((await res.json()) as { ok?: boolean; diff?: string; truncated?: boolean })
            : null;
          if (!patchGate.current.isCurrent(request, `${latestScope.current}:${path}`)) return;
          if (!json?.ok || typeof json.diff !== "string") throw new Error("bad response");
          setOpenPatch({ phase: "ready", text: json.diff, truncated: json.truncated === true, error: null });
        } catch {
          if (!patchGate.current.isCurrent(request, `${latestScope.current}:${path}`)) return;
          setOpenPatch({ phase: "error", text: null, truncated: false, error: `Couldn't load the diff for ${path}.` });
        }
      })();
    },
    [files, kind, projectRoot, scope],
  );

  // Open the first changed file once a list lands, so the center pane is never
  // blank while there is something to read.
  useEffect(() => {
    if (openPath == null && phase === "ready" && files.length > 0) open(files[0].path);
  }, [openPath, phase, files, open]);

  const filesShown = files.length;

  return useMemo(
    () => ({
      kind,
      phase,
      error,
      files,
      filesShown,
      filesTotal: Math.max(filesTotal, filesShown),
      truncated,
      localBranch,
      openPath,
      openPatch,
      open,
      retry: () => void loadList(),
    }),
    [kind, phase, error, files, filesShown, filesTotal, truncated, localBranch, openPath, openPatch, open, loadList],
  );
}
