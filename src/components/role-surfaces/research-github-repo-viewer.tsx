"use client";

import "@/styles/research-github-repo-viewer.css";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Group, Panel, Separator, type PanelImperativeHandle } from "react-resizable-panels";
import { highlightToHtml, MarkdownBlock } from "@/components/message-bubble";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { useAnnouncer } from "@/components/ui/live-region";
import { resolveLangLabel } from "@/lib/code-lang";
import { splitHighlightedLines } from "@/lib/code-lines";
import { Icon } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useMeasuredWidth } from "@/lib/use-measured-width";
import {
  buildGithubRepoTree,
  formatGithubBytes,
  githubRepoFileEndpoint,
  githubRepoFileWebUrl,
  githubRepoReadmeLinkUrl,
  type GithubRepoFileView,
  type GithubRepoSnapshot,
  type RepoTreeNode,
} from "@/lib/research-github-repo";

export type ResearchGithubRepoViewerProps = {
  snapshot: GithubRepoSnapshot;
  openUrl: (url: string) => void;
  relatedContent?: ReactNode;
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

function languageTokenForPath(path: string): string {
  const filename = path.split("/").at(-1) ?? path;
  return (filename.includes(".") ? filename.split(".").at(-1) : filename)?.toLowerCase() || "text";
}

function GithubSourceRows({ path, source }: { path: string; source: string }) {
  const language = languageTokenForPath(path);
  const [lines, setLines] = useState(() => splitHighlightedLines("", source));

  useEffect(() => {
    let cancelled = false;
    setLines(splitHighlightedLines("", source));
    void (async () => {
      try {
        const html = await highlightToHtml(source, language);
        if (!cancelled) setLines(splitHighlightedLines(html, source));
      } catch (error) {
        console.warn("GitHub file syntax highlighting unavailable; displaying plain text.", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [language, source]);

  return (
    <div className="research-gh__source" aria-label={`Source for ${path}`}>
      {lines.map((line, index) => (
        <div className="research-gh__source-row" key={`${path}:${index + 1}`}>
          <span className="research-gh__line-number" aria-hidden="true">
            {index + 1}
          </span>
          <code dangerouslySetInnerHTML={{ __html: line || "&nbsp;" }} />
        </div>
      ))}
    </div>
  );
}

function FileTreeNode({
  node,
  selectedPath,
  onSelect,
  expanded,
  onExpand,
  searching,
}: {
  node: RepoTreeNode;
  selectedPath: string | null;
  onSelect: (node: RepoTreeNode) => void;
  expanded: ReadonlySet<string>;
  onExpand: (path: string, open: boolean) => void;
  searching: boolean;
}) {
  if (node.type === "tree") {
    return (
      <li className="research-gh__node">
        <details
          className="research-gh__dir"
          open={searching || expanded.has(node.path)}
          onToggle={(event) => {
            if (!searching) onExpand(node.path, event.currentTarget.open);
          }}
        >
          <summary className="research-gh__dir-summary focus-ring">
            <Icon className="research-gh__dir-caret" name="ph:caret-right" width={12} height={12} aria-hidden />
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
                expanded={expanded}
                onExpand={onExpand}
                searching={searching}
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
  relatedContent,
}: ResearchGithubRepoViewerProps) {
  const { announce } = useAnnouncer();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matchingEntries = useMemo(
    () => snapshot.tree.filter((entry) => !needle || (entry.type === "blob" && entry.path.toLowerCase().includes(needle))),
    [needle, snapshot.tree],
  );
  const roots = useMemo(
    () => buildGithubRepoTree(
      matchingEntries.filter((entry) => entry.path !== snapshot.readme?.path),
    ),
    [snapshot.readme?.path, matchingEntries],
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const onExpand = useCallback((path: string, open: boolean) => {
    setExpanded((previous) => {
      if (previous.has(path) === open) return previous;
      const next = new Set(previous);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);
  const [selectedPath, setSelectedPath] = useState<string | null>(
    snapshot.readme?.path ?? null,
  );
  const [railOpen, setRailOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const railPanelRef = useRef<PanelImperativeHandle | null>(null);
  const railWidthRef = useRef(256);
  const railId = useId();
  const [fileState, setFileState] = useState<FileState>({ kind: "idle" });
  const requestGenerationRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const workbenchRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const railToggleRef = useRef<HTMLButtonElement>(null);
  const readerBodyRef = useRef<HTMLDivElement>(null);
  const readerScrollRef = useRef({ top: 0, left: 0 });
  const width = useMeasuredWidth(workbenchRef);
  const narrow = width === null || width < 760;

  useFocusTrap(narrow && railOpen, railRef, {
    onEscape: () => setRailOpen(false),
    restoreFocus: () => Boolean(railToggleRef.current?.offsetParent),
  });

  useEffect(() => {
    requestGenerationRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setSelectedPath(snapshot.readme?.path ?? null);
    setRailOpen(false);
    setQuery("");
    setExpanded(new Set());
    setFileState({ kind: "idle" });
  }, [snapshot.owner, snapshot.repo, snapshot.commitSha, snapshot.readme?.path]);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  useLayoutEffect(() => {
    if (!narrow && railCollapsed) railPanelRef.current?.collapse();
    setRailOpen(false);
    const reader = readerBodyRef.current;
    if (reader) {
      reader.scrollTop = readerScrollRef.current.top;
      reader.scrollLeft = readerScrollRef.current.left;
    }
  }, [narrow, railCollapsed]);

  useEffect(() => {
    readerScrollRef.current = { top: 0, left: 0 };
    readerBodyRef.current?.scrollTo(0, 0);
  }, [selectedPath, snapshot.commitSha]);

  const selectReadme = useCallback(() => {
    requestGenerationRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setSelectedPath(snapshot.readme?.path ?? null);
    setRailOpen(false);
    setFileState({ kind: "idle" });
  }, [snapshot.readme?.path]);

  const selectFile = useCallback(async (node: RepoTreeNode) => {
    if (node.type !== "blob" || !node.sha) return;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const generation = ++requestGenerationRef.current;
    setSelectedPath(node.path);
    setRailOpen(false);
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
  const capturedFileCount = snapshot.tree.filter((entry) => entry.type === "blob").length;
  const capturedBytes = snapshot.tree.reduce((total, entry) => total + (entry.size ?? 0), 0);
  const selectedLanguage = selectedPath
    ? resolveLangLabel(languageTokenForPath(selectedPath))
    : null;
  const selectedBytes = selectedFileEntry
    ? formatGithubBytes(selectedFileEntry.size)
    : null;

  const showReadme = snapshot.readme && (!needle || snapshot.readme.path.toLowerCase().includes(needle));
  const files = (
        <nav
          ref={railRef}
          className="research-gh__rail"
          id={railId}
          aria-label="Repository files"
          tabIndex={-1}
        >
          <header>
            <div>
              <strong>Files</strong>
              <span>{capturedFileCount.toLocaleString()} captured</span>
            </div>
            <Button
              className="research-gh__rail-close"
              size="xs"
              variant="ghost"
              aria-label={narrow ? "Close file rail" : "Collapse file rail"}
              onClick={() => {
                railToggleRef.current?.focus();
                if (narrow) setRailOpen(false);
                else {
                  railPanelRef.current?.collapse();
                  setRailCollapsed(true);
                }
              }}
            >
              <Icon name="ph:x" width={13} height={13} aria-hidden />
            </Button>
          </header>
          <SearchInput
            containerClassName="research-gh__search"
            aria-label="Search captured files"
            placeholder="Search files…"
            value={query}
            onValueChange={setQuery}
            onClear={() => setQuery("")}
            hint={needle ? `${matchingEntries.length} captured file matches` : "Search captured paths, not the live repository."}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              }
            }}
          />
          <div className="research-gh__file-list">
          {showReadme && snapshot.readme ? (
            <button
              type="button"
              className="research-gh__readme-link focus-ring"
              aria-current={showingReadme ? "page" : undefined}
              onClick={selectReadme}
              title={`Read ${snapshot.readme.path}`}
            >
              <Icon name="ph:book-open" width={14} height={14} aria-hidden />
              Overview
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
                  expanded={expanded}
                  onExpand={onExpand}
                  searching={Boolean(needle)}
                />
              ))}
            </ul>
          ) : (
            <p className="research-gh__empty" role="status">
              {needle && !showReadme ? "No captured files match. Clear the search to browse the saved tree." : "No additional files were captured."}
            </p>
          )}
          </div>
        </nav>
  );
  const reader = (
        <article className="research-gh__reader" data-source={!showingReadme && fileState.kind === "ready" || undefined}>
          <header className="research-gh__reader-head">
            <div className="research-gh__reader-identity">
              <Button
                ref={railToggleRef}
                className="research-gh__rail-toggle"
                size="xs"
                variant="ghost"
                leadingIcon="ph:sidebar-simple"
                aria-controls={railId}
                aria-expanded={narrow ? railOpen : !railCollapsed}
                onClick={(event) => {
                  // WebKit does not focus clicked buttons; give the trap a return target.
                  event.currentTarget.focus();
                  if (narrow) setRailOpen((current) => !current);
                  else if (railCollapsed) {
                    railPanelRef.current?.expand();
                    railPanelRef.current?.resize(`${railWidthRef.current}px`);
                    setRailCollapsed(false);
                  } else {
                    railPanelRef.current?.collapse();
                    setRailCollapsed(true);
                  }
                }}
              >
                Files
              </Button>
              <div>
                <span>
                  {showingReadme ? "Overview" : selectedPath ? "Source file" : "Repository snapshot"}
                </span>
                <strong>{selectedPath ?? "Select a file to read it in Cave"}</strong>
              </div>
            </div>
            <div className="research-gh__reader-actions">
              {selectedFileEntry ? (
                <div className="research-gh__reader-facts" aria-label="Selected file details">
                  {selectedLanguage ? <span>{selectedLanguage}</span> : null}
                  {selectedBytes ? <span>{selectedBytes}</span> : null}
                </div>
              ) : null}
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
            </div>
          </header>

          <div
            ref={readerBodyRef}
            className="research-gh__reader-body focus-ring"
            tabIndex={0}
            aria-label={selectedPath ? `${selectedPath} document` : "Repository document"}
            onScroll={(event) => {
              readerScrollRef.current = { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft };
            }}
          >
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
              <GithubSourceRows path={fileState.path} source={fileState.file.text} />
            ) : (
              <p className="research-gh__state">
                {snapshot.readme
                  ? "Choose the overview or a source file from the saved tree."
                  : "Choose a text file from the saved tree to read its captured blob."}
              </p>
            )}
          </div>
        </article>
  );

  return (
    <section
      ref={workbenchRef}
      className="research-gh"
      aria-label={`${snapshot.owner}/${snapshot.repo} repository workbench`}
    >
      <div className="research-gh__context" aria-label="Captured repository context">
        <Icon name="ph:git-commit" width={16} height={16} aria-hidden />
        <span>Captured snapshot</span>
        <strong title={`Ref resolved at capture: ${snapshot.resolvedRef}`}>{snapshot.resolvedRef}</strong>
        <code title={snapshot.commitSha}>{snapshot.commitSha.slice(0, 12)}</code>
        <time dateTime={snapshot.fetchedAt} title={new Date(snapshot.fetchedAt).toLocaleString()}>
          Captured {new Date(snapshot.fetchedAt).toLocaleDateString()}
        </time>
        {snapshot.truncated ? <span className="research-gh__truncated" role="status">Tree listing truncated</span> : null}
      </div>
      <details className="research-gh__details">
        <summary className="focus-ring">Repository details</summary>
        <div className="research-gh__details-body">
          {snapshot.description ? <p>{snapshot.description}</p> : null}
          <dl>
            <div><dt>Captured commit</dt><dd>{snapshot.commitSha}</dd></div>
            <div><dt>Ref at capture</dt><dd>{snapshot.resolvedRef}</dd></div>
            <div><dt>Captured</dt><dd>{new Date(snapshot.fetchedAt).toLocaleString()}</dd></div>
            <div><dt>Files captured</dt><dd>{capturedFileCount.toLocaleString()} · {formatGithubBytes(capturedBytes)}</dd></div>
            {snapshot.primaryLanguage ? <div><dt>Language</dt><dd>{snapshot.primaryLanguage}</dd></div> : null}
            {snapshot.licenseSpdx ? <div><dt>License</dt><dd>{snapshot.licenseSpdx}</dd></div> : null}
            <div><dt>Visibility</dt><dd>{snapshot.visibility}</dd></div>
            <div><dt>Stars / forks at capture</dt><dd>{snapshot.stars.toLocaleString()} / {snapshot.forks.toLocaleString()}</dd></div>
          </dl>
          {relatedContent}
        </div>
      </details>
      <div className="research-gh__workspace" data-narrow={narrow || undefined} data-rail-open={railOpen || undefined}>
        {narrow ? <>{files}{reader}</> : (
          <Group className="research-gh__split" orientation="horizontal">
            <Panel
              id="files"
              panelRef={railPanelRef}
              defaultSize={`${railWidthRef.current}px`}
              minSize="192px"
              maxSize="384px"
              collapsible
              collapsedSize={0}
              onResize={(size) => {
                const collapsed = size.inPixels === 0;
                setRailCollapsed(collapsed);
                // A shrinking container can clamp the panel before React swaps
                // in the drawer. Do not replace the saved desktop width then.
                if (!collapsed && (workbenchRef.current?.clientWidth ?? 0) >= 760) {
                  railWidthRef.current = size.inPixels;
                }
              }}
            >
              {files}
            </Panel>
            <Separator className="shell-separator research-gh__separator" aria-label="Resize file rail">
              <SeparatorHandle orientation="col" />
            </Separator>
            <Panel id="reader" minSize="360px">{reader}</Panel>
          </Group>
        )}
      </div>
    </section>
  );
}
