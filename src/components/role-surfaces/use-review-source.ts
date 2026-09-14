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
import { createReviewRequestGate, type ReviewRequest } from "./review-deck";
import { parseGitHubDiffRevision, type GitHubDiffRevision } from "@/lib/github-review";

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
  revision: GitHubDiffRevision | null;
  openPath: string | null;
  openPatch: OpenPatch;
  open: (path: string) => void;
  retry: () => void;
};

type DiffWire = {
  ok?: boolean;
  revision?: unknown;
  error?: string;
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
  const { pr, projectRoot } = input;
  const scope = `${input.scope}:${pr?.repo ?? "none"}#${pr?.number ?? "none"}:${projectRoot ?? "none"}`;
  const kind: ReviewSourceKind = pr ? "pull-request" : projectRoot ? "local" : "none";

  const [phase, setPhase] = useState<SourcePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [filesTotal, setFilesTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [localBranch, setLocalBranch] = useState<string | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [openPatch, setOpenPatch] = useState<OpenPatch>(IDLE_PATCH);
  const [revision, setRevision] = useState<GitHubDiffRevision | null>(null);
  const [loadedRequest, setLoadedRequest] = useState<ReviewRequest | null>(null);

  const latestScope = useRef(scope);
  latestScope.current = scope;
  const listGate = useRef(createReviewRequestGate());
  const patchGate = useRef(createReviewRequestGate());
  const lastOpened = useRef<{ scope: string; path: string } | null>(null);

  const repo = pr?.repo ?? null;
  const number = pr?.number ?? null;

  const loadList = useCallback(async () => {
    const request = listGate.current.begin(scope);
    setLoadedRequest(request);
    setRevision(null);
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
        if (!res.ok || !json?.ok || !Array.isArray(json.files)) {
          throw new Error(json?.error || "Couldn't read the pull request diff.");
        }
        const displayedRevision = parseGitHubDiffRevision(json.revision);
        if (!displayedRevision || displayedRevision.repo.toLowerCase() !== repo.toLowerCase() ||
            displayedRevision.number !== number) {
          throw new Error("Pull request diff revision is unavailable or does not match this selection. Refresh to retry.");
        }
        const parsed: ReviewFile[] = json.files.map((file) => ({
          path: typeof file.filename === "string" ? file.filename : "",
          status: fileStatus(file.status),
          additions: num(file.additions),
          deletions: num(file.deletions),
          patch: typeof file.patch === "string" ? file.patch : null,
          noPatchReason: file.noPatchReason ?? (typeof file.patch === "string" ? null : "github"),
        }));
        setFiles(parsed);
        setRevision(displayedRevision);
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
    } catch (error) {
      if (!listGate.current.isCurrent(request, latestScope.current)) return;
      setPhase("error");
      setError(
        error instanceof Error && repo ? error.message : repo
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
      // An effect or retained callback may belong to a previous list even
      // when React batches its completion with a selection change/refresh.
      if (!loadedRequest || phase !== "ready" ||
          !listGate.current.isCurrent(loadedRequest, latestScope.current)) return;
      lastOpened.current = { scope, path };
      setOpenPath(path);

      // PR patches are derived from the owned file list below, never copied
      // into a second cache by an effect from a different revision.
      if (kind === "pull-request") {
        patchGate.current.invalidate();
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
    [loadedRequest, phase, kind, projectRoot, scope],
  );

  useEffect(() => {
    if (loadedRequest && listGate.current.isCurrent(loadedRequest, latestScope.current) &&
        openPath == null && phase === "ready" && files.length > 0) {
      const previous = lastOpened.current;
      const retained = previous?.scope === scope && files.some((file) => file.path === previous.path);
      open(retained ? previous.path : files[0].path);
    }
  }, [loadedRequest, openPath, phase, files, open, scope]);

  const filesShown = files.length;
  const latestLoadList = useRef(loadList);
  latestLoadList.current = loadList;
  const retry = useCallback(() => {
    void latestLoadList.current();
  }, []);

  // Effects run after rendering. Never expose the previous selection's ready
  // state (or patch) during the render that switches the selected PR/session.
  const current = loadedRequest != null && listGate.current.isCurrent(loadedRequest, scope);
  const openFile = current && phase === "ready"
    ? files.find((file) => file.path === openPath) : undefined;
  return useMemo(
    () => ({
      kind,
      phase: current ? phase : kind === "none" ? "idle" : "loading",
      error: current ? error : null,
      files: current ? files : [],
      filesShown: current ? filesShown : 0,
      filesTotal: current ? Math.max(filesTotal, filesShown) : 0,
      truncated: current && truncated,
      localBranch: current ? localBranch : null,
      revision: current ? revision : null,
      openPath: current ? openPath : null,
      openPatch: !current || phase !== "ready" ? IDLE_PATCH
        : kind === "pull-request"
          ? { phase: openFile ? "ready" : "idle", text: openFile?.patch ?? null, truncated: false, error: null }
          : openPatch,
      open,
      retry,
    }),
    [current, kind, phase, error, files, filesShown, filesTotal, truncated, localBranch, revision, openPath, openFile, openPatch, open, retry],
  );
}
