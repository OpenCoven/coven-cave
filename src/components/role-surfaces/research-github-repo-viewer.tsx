"use client";

import "@/styles/research-github-repo-viewer.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownBlock } from "@/components/message-bubble";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { Icon } from "@/lib/icon";
import {
  buildGithubRepoTree,
  formatGithubBytes,
  githubRepoFileEndpoint,
  githubRepoFileWebUrl,
  githubRepoReadmeLinkUrl,
  githubRepoTreeWebUrl,
  type GithubRepoFileView,
  type GithubRepoSnapshot,
  type RepoTreeNode,
} from "@/lib/research-github-repo";

export type ResearchGithubRepoViewerProps = {
  snapshot: GithubRepoSnapshot;
  openUrl: (url: string) => void;
};

type FileState =
  | { kind: "idle" }
  | { kind: "loading"; path: string }
  | { kind: "ready"; path: string; file: GithubRepoFileView }
  | { kind: "error"; path: string; message: string };

function fileIconName(path: string): "ph:file-code" | "ph:file-text" {
  return /\.[cm]?[jt]sx?$|\.(?:json|md|mdx|yaml|yml|toml|css|html|rs|go|py|rb)$/i.test(path)
    ? "ph:file-code"
    : "ph:file-text";
}

function FileTreeNode({
  node,
  selectedPath,
  onSelect,
}: {
  node: RepoTreeNode;
  selectedPath: string | null;
  onSelect: (node: RepoTreeNode) => void;
}) {
  if (node.type === "tree") {
    return (
      <li className="research-gh__node">
        <details className="research-gh__dir">
          <summary className="research-gh__dir-summary focus-ring">
            <Icon name="ph:folder" width={14} height={14} aria-hidden />
            <span>{node.name}</span>
            <span className="sr-only"> folder</span>
          </summary>
          <ul className="research-gh__children">
            {(node.children ?? []).map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </details>
      </li>
    );
  }

  const size = formatGithubBytes(node.size);
  return (
    <li className="research-gh__node">
      <button
        type="button"
        className="research-gh__file focus-ring"
        aria-current={selectedPath === node.path ? "page" : undefined}
        onClick={() => onSelect(node)}
        title={`Read ${node.path}`}
      >
        <Icon name={fileIconName(node.path)} width={14} height={14} aria-hidden />
        <span className="research-gh__file-name">{node.name}</span>
        {size ? <span className="research-gh__file-size">{size}</span> : null}
      </button>
    </li>
  );
}

export function ResearchGithubRepoViewer({
  snapshot,
  openUrl,
}: ResearchGithubRepoViewerProps) {
  const { announce } = useAnnouncer();
  const roots = useMemo(() => buildGithubRepoTree(snapshot.tree), [snapshot.tree]);
  const [selectedPath, setSelectedPath] = useState<string | null>(
    snapshot.readme?.path ?? null,
  );
  const [fileState, setFileState] = useState<FileState>({ kind: "idle" });
  const requestGenerationRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    requestGenerationRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setSelectedPath(snapshot.readme?.path ?? null);
    setFileState({ kind: "idle" });
  }, [snapshot.commitSha, snapshot.readme?.path]);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  const selectReadme = useCallback(() => {
    requestGenerationRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setSelectedPath(snapshot.readme?.path ?? null);
    setFileState({ kind: "idle" });
  }, [snapshot.readme?.path]);

  const selectFile = useCallback(async (node: RepoTreeNode) => {
    if (node.type !== "blob" || !node.sha) return;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const generation = ++requestGenerationRef.current;
    setSelectedPath(node.path);
    setFileState({ kind: "loading", path: node.path });
    try {
      const response = await fetch(
        githubRepoFileEndpoint(`${snapshot.owner}/${snapshot.repo}`, node.sha),
        { signal: controller.signal },
      );
      const payload = (await response.json().catch(() => null)) as
        | ({ ok: true } & GithubRepoFileView)
        | { ok: false; error?: string }
        | null;
      if (requestGenerationRef.current !== generation) return;
      if (!response.ok || !payload || payload.ok !== true) {
        const message =
          (payload && "error" in payload && payload.error)
          || `Cave couldn't preview this file (${response.status}).`;
        setFileState({ kind: "error", path: node.path, message });
        announce(`Couldn't preview ${node.name}.`, "assertive");
        return;
      }
      setFileState({
        kind: "ready",
        path: node.path,
        file: { sha: payload.sha, text: payload.text, bytes: payload.bytes },
      });
      announce(`Opened ${node.path}.`);
    } catch (error) {
      if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
      setFileState({
        kind: "error",
        path: node.path,
        message: "Couldn't reach GitHub. Check your connection and try again.",
      });
      announce(`Couldn't preview ${node.name}.`, "assertive");
    }
  }, [announce, snapshot.owner, snapshot.repo]);

  const selectedFileEntry = snapshot.tree.find(
    (entry) => entry.type === "blob" && entry.path === selectedPath,
  );
  const resolveReadmeUrl = useCallback((href: string) => (
    snapshot.readme
      ? githubRepoReadmeLinkUrl({
          owner: snapshot.owner,
          repo: snapshot.repo,
          commitSha: snapshot.commitSha,
          readmePath: snapshot.readme.path,
        }, href)
      : null
  ), [snapshot.commitSha, snapshot.owner, snapshot.readme, snapshot.repo]);
  const showingReadme = Boolean(snapshot.readme && selectedPath === snapshot.readme.path);
  const treeUrl = githubRepoTreeWebUrl(snapshot.owner, snapshot.repo, snapshot.commitSha);

  return (
    <section className="research-gh" aria-label={`${snapshot.owner}/${snapshot.repo} repository`}>
      <header className="research-gh__header">
        <div className="research-gh__identity">
          <span className="research-gh__glyph" aria-hidden>
            <Icon name="ph:github-logo" width={20} height={20} />
          </span>
          <div>
            <span className="research-gh__eyebrow">Saved GitHub repository</span>
            <h4>{snapshot.owner}/{snapshot.repo}</h4>
            {snapshot.description ? <p>{snapshot.description}</p> : null}
          </div>
        </div>
        <Button
          size="xs"
          variant="ghost"
          trailingIcon="ph:arrow-square-out"
          onClick={() => openUrl(treeUrl)}
        >
          Open captured tree
        </Button>
      </header>

      <div className="research-gh__provenance" aria-label="Snapshot provenance">
        <span className="research-gh__commit-marker" aria-hidden>
          <Icon name="ph:git-commit" width={15} height={15} />
        </span>
        <span className="research-gh__provenance-line" aria-hidden />
        <div>
          <span>Captured commit</span>
          <strong>{snapshot.commitSha.slice(0, 12)}</strong>
        </div>
        <div>
          <span>Resolved from</span>
          <strong>{snapshot.resolvedRef}</strong>
        </div>
        <div>
          <span>Captured</span>
          <strong>{new Date(snapshot.fetchedAt).toLocaleString()}</strong>
        </div>
        {snapshot.truncated ? (
          <span className="research-gh__truncated">Tree listing truncated</span>
        ) : null}
      </div>

      <div className="research-gh__facts" aria-label="Repository metadata">
        {snapshot.primaryLanguage ? <span>{snapshot.primaryLanguage}</span> : null}
        {snapshot.licenseSpdx ? <span>{snapshot.licenseSpdx}</span> : null}
        <span>{snapshot.visibility}</span>
        <span>{snapshot.stars.toLocaleString()} stars</span>
        <span>{snapshot.forks.toLocaleString()} forks</span>
      </div>

      <div className="research-gh__workspace">
        <nav className="research-gh__rail" aria-label="Repository files">
          <header>
            <strong>Files</strong>
            <span>{snapshot.tree.length} entries</span>
          </header>
          {snapshot.readme ? (
            <button
              type="button"
              className="research-gh__readme-link focus-ring"
              aria-current={showingReadme ? "page" : undefined}
              onClick={selectReadme}
            >
              <Icon name="ph:book-open" width={14} height={14} aria-hidden />
              {snapshot.readme.path}
            </button>
          ) : null}
          {roots.length > 0 ? (
            <ul className="research-gh__tree">
              {roots.map((node) => (
                <FileTreeNode
                  key={node.path}
                  node={node}
                  selectedPath={selectedPath}
                  onSelect={(selected) => void selectFile(selected)}
                />
              ))}
            </ul>
          ) : (
            <p className="research-gh__empty">No saved tree entries.</p>
          )}
        </nav>

        <article className="research-gh__reader" aria-live="polite">
          <header className="research-gh__reader-head">
            <div>
              <span>{showingReadme ? "README" : selectedPath ? "Source file" : "Repository snapshot"}</span>
              <strong>{selectedPath ?? "Select a file to read it in Cave"}</strong>
            </div>
            {selectedFileEntry ? (
              <Button
                size="xs"
                variant="ghost"
                trailingIcon="ph:arrow-square-out"
                onClick={() => openUrl(githubRepoFileWebUrl(
                  snapshot.owner,
                  snapshot.repo,
                  snapshot.commitSha,
                  selectedFileEntry.path,
                ))}
              >
                Open on GitHub
              </Button>
            ) : null}
          </header>

          {showingReadme && snapshot.readme ? (
            <MarkdownBlock
              text={snapshot.readme.markdown}
              className="research-gh__markdown cave-md--expanded cave-md--reader"
              onOpenUrl={openUrl}
              resolveOpenUrl={resolveReadmeUrl}
              suppressRemoteMedia
            />
          ) : fileState.kind === "loading" && fileState.path === selectedPath ? (
            <p className="research-gh__state" role="status">Loading file…</p>
          ) : fileState.kind === "error" && fileState.path === selectedPath ? (
            <div className="research-gh__state research-gh__state--error" role="alert">
              <p>{fileState.message}</p>
              {selectedFileEntry ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void selectFile({
                    name: selectedFileEntry.path.split("/").at(-1) ?? selectedFileEntry.path,
                    path: selectedFileEntry.path,
                    type: "blob",
                    sha: selectedFileEntry.sha,
                    size: selectedFileEntry.size,
                  })}
                >
                  Retry
                </Button>
              ) : null}
            </div>
          ) : fileState.kind === "ready" && fileState.path === selectedPath ? (
            <pre className="research-gh__source" tabIndex={0}>
              <code>{fileState.file.text}</code>
            </pre>
          ) : (
            <p className="research-gh__state">
              {snapshot.readme
                ? "Choose the README or a source file from the saved tree."
                : "Choose a text file from the saved tree to read its captured blob."}
            </p>
          )}
        </article>
      </div>
    </section>
  );
}
