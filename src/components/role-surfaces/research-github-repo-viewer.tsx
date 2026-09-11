"use client";

import "@/styles/research-github-repo-viewer.css";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { MarkdownBlock } from "@/components/message-bubble";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { RelativeTime } from "@/components/ui/relative-time";
import { copyText } from "@/lib/clipboard";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { Icon, type IconName } from "@/lib/icon";
import {
  buildGithubRepoTree,
  formatGithubBytes,
  githubRepoFileEndpoint,
  githubRepoFileWebUrl,
  githubRepoReadmeLinkUrl,
  githubRepoTreeWebUrl,
  githubRepoWebUrl,
  type GithubRepoFileView,
  type GithubRepoSnapshot,
  type GithubRepoSummary,
  type RepoTreeNode,
} from "@/lib/research-github-repo";
import {
  collapseSingleChildChains,
  filterRepoFiles,
  flattenRepoTree,
  repoBreadcrumb,
  repoFileIsPreviewable,
  repoPathsToReveal,
  repoFileKind,
  repoRowSizeLabel,
  REPO_FILE_PREVIEW_BYTE_LIMIT,
  type RepoTreeRow,
} from "@/lib/research-github-repo-browser";

export type ResearchGithubRepoViewerProps = {
  /** Always present — the saved list already carries repository metadata, so
   *  the header is complete before the tree finishes loading. */
  summary: GithubRepoSummary;
  /** The full snapshot, or null while the detail request is in flight. */
  snapshot: GithubRepoSnapshot | null;
  loadError: string | null;
  onRetryLoad: () => void;
  openUrl: (url: string) => void;
  onClose: () => void;
  onPreviewInBrowser: () => void;
  /** Overlay-owned destructive control (remove / delete + its confirm state). */
  removeSlot: ReactNode;
  /** Overlay-owned "Add to run" control, or its unavailable-state hint. */
  addToRunSlot: ReactNode;
};

/**
 * A language's own brand colour, which is the one piece of ink in this modal
 * that cannot resolve through `foundations.css`: the dot means "Swift" only
 * because it is Swift's orange. Kept to the languages a saved repository
 * actually surfaces; anything unlisted falls back to a themed neutral.
 */
const LANGUAGE_COLORS: Readonly<Record<string, string>> = {
  c: "#555555",
  "c#": "#178600",
  "c++": "#f34b7d",
  css: "#563d7c",
  dart: "#00b4ab",
  elixir: "#6e4a7e",
  go: "#00add8",
  haskell: "#5e5086",
  html: "#e34c26",
  java: "#b07219",
  javascript: "#f1e05a",
  kotlin: "#a97bff",
  lua: "#000080",
  "objective-c": "#438eff",
  ocaml: "#3be133",
  perl: "#0298c3",
  php: "#4f5d95",
  python: "#3572a5",
  r: "#198ce7",
  ruby: "#701516",
  rust: "#dea584",
  scala: "#c22d40",
  shell: "#89e051",
  swift: "#f05138",
  typescript: "#3178c6",
  vue: "#41b883",
  zig: "#ec915c",
};

function languageColor(language: string): string | null {
  return LANGUAGE_COLORS[language.trim().toLowerCase()] ?? null;
}

const SHORTCUTS: ReadonlyArray<{ label: string; keys: string }> = [
  { label: "Filter files", keys: "/" },
  { label: "Focus filter", keys: "⌘K" },
  { label: "Move in tree", keys: "↑↓" },
  { label: "Expand / collapse", keys: "→←" },
  { label: "Open file", keys: "↵" },
  { label: "Copy path", keys: "⌘⇧C" },
  { label: "Copy repo URL", keys: "⌘⇧U" },
  { label: "Open on GitHub", keys: "⌘↵" },
  { label: "Preview in browser", keys: "⌘B" },
  { label: "Toggle file rail", keys: "⌘\\" },
  { label: "Soft wrap", keys: "⌥Z" },
  { label: "Shortcuts", keys: "?" },
  { label: "Clear, then close", keys: "Esc" },
];

type FileState =
  | { kind: "idle" }
  | { kind: "loading"; path: string }
  | { kind: "ready"; path: string; file: GithubRepoFileView }
  | { kind: "error"; path: string; message: string };

/** What the rail is showing: the real tree, or a flat ranked filter result. */
type RailRow =
  | { kind: "tree"; key: string; row: RepoTreeRow }
  | { kind: "hit"; key: string; node: RepoTreeNode; dir: string };

function fileIconName(path: string): IconName {
  const kind = repoFileKind(path);
  if (kind === "image") return "ph:image";
  if (kind === "binary") return "ph:file-x";
  return /\.[cm]?[jt]sx?$|\.(?:json|yaml|yml|toml|css|scss|html|rs|go|py|rb|swift|kt|java|c|h|cpp|sh|sql)$/i
    .test(path)
    ? "ph:file-code"
    : "ph:file-text";
}

export function ResearchGithubRepoViewer({
  summary,
  snapshot,
  loadError,
  onRetryLoad,
  openUrl,
  onClose,
  onPreviewInBrowser,
  removeSlot,
  addToRunSlot,
}: ResearchGithubRepoViewerProps) {
  const { announce } = useAnnouncer();
  const helpTitleId = useId();

  // ── Identity comes from the snapshot once it lands, and from the saved
  //    summary before that, so the header never flickers or renders empty.
  const meta = snapshot ?? summary;
  const slug = `${meta.owner}/${meta.repo}`;
  const repoUrl = githubRepoWebUrl(meta.owner, meta.repo);
  const shortSha = meta.commitSha.slice(0, 7);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [railOpen, setRailOpen] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [activeRow, setActiveRow] = useState(0);
  const [fileState, setFileState] = useState<FileState>({ kind: "idle" });
  const [flash, setFlash] = useState<"url" | "path" | "sha" | null>(null);

  const filterRef = useRef<HTMLInputElement | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  const helpRef = useRef<HTMLDivElement | null>(null);
  const requestGenerationRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    requestControllerRef.current?.abort();
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
  }, []);

  // The shortcuts sheet is a modal layer over a dialog that already has a trap.
  // Registering its own makes it the topmost trap, so Tab cycles inside the
  // sheet rather than through the controls it covers, and focus returns to the
  // trigger when it closes — which matters because the overflow item that opens
  // it unmounts on the same click.
  useFocusTrap(helpOpen, helpRef, { onEscape: () => setHelpOpen(false) });

  const flashFor = useCallback((key: "url" | "path" | "sha") => {
    setFlash(key);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(null), 1_400);
  }, []);

  // A different capture is a different repository as far as this view is
  // concerned: drop the selection, the filter and any in-flight blob.
  useEffect(() => {
    requestGenerationRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setSelectedPath(null);
    setFileState({ kind: "idle" });
    setFilter("");
    setActiveRow(0);
  }, [meta.commitSha]);

  const roots = useMemo(
    () => (snapshot ? collapseSingleChildChains(buildGithubRepoTree(snapshot.tree)) : []),
    [snapshot],
  );
  const nodesByPath = useMemo(() => {
    const map = new Map<string, RepoTreeNode>();
    const walk = (nodes: readonly RepoTreeNode[]) => {
      for (const node of nodes) {
        map.set(node.path, node);
        if (node.children?.length) walk(node.children);
      }
    };
    walk(roots);
    return map;
  }, [roots]);

  // `tree` carries directories as well as blobs, so its length is not a file
  // count — it would overstate every repository that has folders.
  const fileCount = useMemo(
    () => (snapshot ? snapshot.tree.reduce((n, e) => (e.type === "blob" ? n + 1 : n), 0) : 0),
    [snapshot],
  );
  const filtering = filter.trim().length > 0;
  const hits = useMemo(
    () => (snapshot && filtering ? filterRepoFiles(snapshot.tree, filter) : []),
    [filter, filtering, snapshot],
  );

  const rows = useMemo<RailRow[]>(() => {
    if (filtering) {
      return hits.map((hit) => ({
        kind: "hit" as const,
        key: hit.path,
        dir: hit.dir,
        node: {
          name: hit.name,
          path: hit.path,
          type: "blob" as const,
          sha: hit.sha,
          ...(hit.size === undefined ? {} : { size: hit.size }),
        },
      }));
    }
    return flattenRepoTree(roots, expanded).map((row) => ({
      kind: "tree" as const,
      key: row.node.path,
      row,
    }));
  }, [expanded, filtering, hits, roots]);

  // The roving tab stop must always land on a row that exists, including after
  // a filter keystroke shortens the list under it.
  useEffect(() => {
    setActiveRow((current) => (rows.length === 0 ? 0 : Math.min(current, rows.length - 1)));
  }, [rows.length]);

  const readme = snapshot?.readme ?? null;
  const readmeSize = useMemo(
    () => (readme ? formatGithubBytes(new TextEncoder().encode(readme.markdown).byteLength) : null),
    [readme],
  );
  const showingReadme = selectedPath === null;
  const selectedNode = selectedPath ? nodesByPath.get(selectedPath) ?? null : null;
  const selectedName = selectedPath?.split("/").at(-1) ?? null;

  const loadFile = useCallback(async (node: RepoTreeNode) => {
    if (node.type !== "blob" || !node.sha) return;
    requestControllerRef.current?.abort();
    if (!repoFileIsPreviewable(node.path, node.size)) {
      requestGenerationRef.current += 1;
      requestControllerRef.current = null;
      setFileState({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const generation = ++requestGenerationRef.current;
    setFileState({ kind: "loading", path: node.path });
    try {
      const response = await fetch(
        githubRepoFileEndpoint(slug, node.sha),
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
          || `Cave couldn’t preview this file (${response.status}).`;
        setFileState({ kind: "error", path: node.path, message });
        announce(`Couldn’t preview ${node.name}.`, "assertive");
        return;
      }
      setFileState({
        kind: "ready",
        path: node.path,
        file: { sha: payload.sha, text: payload.text, bytes: payload.bytes },
      });
      announce(`Opened ${node.path}.`);
    } catch {
      if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
      setFileState({
        kind: "error",
        path: node.path,
        message: "Couldn’t reach GitHub. Check your connection and try again.",
      });
      announce(`Couldn’t preview ${node.name}.`, "assertive");
    }
  }, [announce, slug]);

  const selectFile = useCallback((node: RepoTreeNode) => {
    setSelectedPath(node.path);
    void loadFile(node);
  }, [loadFile]);

  const selectReadme = useCallback(() => {
    requestGenerationRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setSelectedPath(null);
    setFileState({ kind: "idle" });
  }, []);

  const toggleDir = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /**
   * Re-root the rail onto a path: open every directory row that contains it.
   * Chain collapsing means those rows are not the path's raw ancestors, so the
   * set is computed against the rendered tree rather than against the string.
   */
  const revealPath = useCallback((path: string) => {
    setFilter("");
    setExpanded((current) => {
      const next = new Set(current);
      for (const open of repoPathsToReveal(roots, path)) next.add(open);
      return next;
    });
  }, [roots]);

  const activateRow = useCallback((row: RailRow) => {
    if (row.kind === "hit") {
      revealPath(row.node.path);
      selectFile(row.node);
      return;
    }
    if (row.row.node.type === "tree") toggleDir(row.row.node.path);
    else selectFile(row.row.node);
  }, [revealPath, selectFile, toggleDir]);

  // ── The one action the footer's primary slot points at, which is whatever
  //    the reader is currently showing rather than a fixed destination.
  const primaryUrl = selectedPath
    ? githubRepoFileWebUrl(meta.owner, meta.repo, meta.commitSha, selectedPath)
    : repoUrl;
  // The label already names the destination when nothing is selected, so the
  // tooltip must not append it a second time.
  const primaryLabel = selectedName ? `Open ${selectedName}` : "Open on GitHub";
  const primaryTitle = selectedName ? `Open ${selectedName} on GitHub  ⌘↵` : "Open on GitHub  ⌘↵";

  const copyRepoUrl = useCallback(() => {
    void copyText(repoUrl).then((ok) => {
      if (ok) flashFor("url");
      announce(ok ? "Repository URL copied." : "Couldn’t copy the URL.", ok ? "polite" : "assertive");
    });
  }, [announce, flashFor, repoUrl]);

  const copySelectionPath = useCallback(() => {
    const value = selectedPath ?? readme?.path ?? slug;
    void copyText(value).then((ok) => {
      if (ok) flashFor("path");
      announce(ok ? "Path copied." : "Couldn’t copy the path.", ok ? "polite" : "assertive");
    });
  }, [announce, flashFor, readme?.path, selectedPath, slug]);

  const copyCommitSha = useCallback(() => {
    void copyText(meta.commitSha).then((ok) => {
      if (ok) flashFor("sha");
      announce(ok ? "Commit SHA copied." : "Couldn’t copy the SHA.", ok ? "polite" : "assertive");
    });
  }, [announce, flashFor, meta.commitSha]);

  const focusFilter = useCallback(() => {
    setRailOpen(true);
    // The input may be mounting this tick if the rail was collapsed.
    requestAnimationFrame(() => filterRef.current?.focus());
  }, []);

  // Dismiss the overflow menu on any outside pointer press, the way every
  // other menu in the cave behaves.
  useEffect(() => {
    if (!overflowOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!overflowRef.current?.contains(event.target as Node)) setOverflowOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [overflowOpen]);

  /**
   * Escape is layered — help, then menu, then filter, then the modal — so it
   * never closes more than the user asked it to. Anything this handler
   * consumes is stopped here; anything it does not reaches the overlay's focus
   * trap, which closes the dialog.
   *
   * This one stays a REACT handler rather than joining the window listener
   * below, and the split is load-bearing: the overlay's trap listens on
   * `window` and calls `stopImmediatePropagation` on Escape. React dispatches
   * from its root before the event reaches window, so handling Escape here is
   * what lets the inner layers run at all — move it to window and the trap
   * closes the whole modal on the first press.
   */
  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    if (helpOpen) { setHelpOpen(false); event.stopPropagation(); event.preventDefault(); return; }
    if (overflowOpen) { setOverflowOpen(false); event.stopPropagation(); event.preventDefault(); return; }
    if (filter) {
      setFilter("");
      event.stopPropagation();
      event.preventDefault();
    }
    // Anything left falls through to the overlay: close the modal.
  }, [filter, helpOpen, overflowOpen]);

  /**
   * Every other shortcut listens on `window` while the modal is mounted.
   *
   * A React handler on the section only sees keys dispatched from inside it,
   * and focus leaves the section constantly through no fault of the user: the
   * rail toggle, the filter's clear button and every overflow item UNMOUNT
   * themselves on click, which drops focus to `<body>`. With the handler bound
   * to the section, `?` and `/` silently stopped working after any of those —
   * a hole an e2e test caught by pressing `?` right after reopening the rail.
   */
  useEffect(() => {
    // The surface's behavior tests render through react-test-renderer, which
    // has no DOM — and a shortcut layer is not a reason for a component to
    // require one.
    if (typeof window === "undefined") return;
    const onWindowKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      const mod = event.metaKey || event.ctrlKey;

      // Escape belongs to the React handler above, which owns the layering.
      if (event.key === "Escape") return;

      if (mod && event.key === "Enter") {
        event.preventDefault();
        openUrl(primaryUrl);
        return;
      }
      if (mod && event.shiftKey && (event.key === "U" || event.key === "u")) {
        event.preventDefault();
        copyRepoUrl();
        return;
      }
      if (mod && event.shiftKey && (event.key === "C" || event.key === "c")) {
        event.preventDefault();
        copySelectionPath();
        return;
      }
      if (mod && (event.key === "b" || event.key === "B")) {
        event.preventDefault();
        onPreviewInBrowser();
        return;
      }
      if (mod && event.key === "\\") {
        event.preventDefault();
        setRailOpen((open) => !open);
        return;
      }
      if (mod && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        focusFilter();
        return;
      }
      // ⌥Z on macOS emits "Ω" as the key; both spellings mean soft wrap.
      if (event.altKey && (event.key === "z" || event.key === "Z" || event.key === "Ω")) {
        event.preventDefault();
        setWrap((current) => !current);
        return;
      }
      // A bare letter typed into the filter is text, not a shortcut.
      if (typing || mod || event.altKey) return;
      if (event.key === "/") {
        event.preventDefault();
        focusFilter();
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", onWindowKey);
    return () => window.removeEventListener("keydown", onWindowKey);
  }, [
    copyRepoUrl,
    copySelectionPath,
    focusFilter,
    onPreviewInBrowser,
    openUrl,
    primaryUrl,
  ]);

  /**
   * The tree is one tab stop with the arrows moving inside it — the WAI-ARIA
   * tree pattern — so Tab still walks the modal's controls in reading order
   * rather than through 119 rows.
   */
  const onTreeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return;
    const row = rows[activeRow];
    const move = (next: number) => {
      event.preventDefault();
      event.stopPropagation();
      const clamped = Math.max(0, Math.min(next, rows.length - 1));
      setActiveRow(clamped);
      const el = treeRef.current?.querySelector<HTMLElement>(`[data-row-index="${clamped}"]`);
      el?.focus();
      el?.scrollIntoView({ block: "nearest" });
    };
    switch (event.key) {
      case "ArrowDown": move(activeRow + 1); return;
      case "ArrowUp": move(activeRow - 1); return;
      case "Home": move(0); return;
      case "End": move(rows.length - 1); return;
      case "Enter": {
        event.preventDefault();
        event.stopPropagation();
        if (row) activateRow(row);
        return;
      }
      case "ArrowRight": {
        if (row?.kind !== "tree" || row.row.node.type !== "tree") return;
        event.preventDefault();
        event.stopPropagation();
        if (!row.row.expanded) toggleDir(row.row.node.path);
        else move(activeRow + 1);
        return;
      }
      case "ArrowLeft": {
        if (row?.kind !== "tree") return;
        event.preventDefault();
        event.stopPropagation();
        if (row.row.node.type === "tree" && row.row.expanded) {
          toggleDir(row.row.node.path);
          return;
        }
        // On a file (or a closed folder), step out to the parent row.
        for (let index = activeRow - 1; index >= 0; index--) {
          const candidate = rows[index];
          if (candidate.kind === "tree" && candidate.row.depth < row.row.depth) {
            move(index);
            return;
          }
        }
      }
    }
  }, [activateRow, activeRow, rows, toggleDir]);

  const resolveReadmeUrl = useCallback((href: string) => (
    readme
      ? githubRepoReadmeLinkUrl({
          owner: meta.owner,
          repo: meta.repo,
          commitSha: meta.commitSha,
          readmePath: readme.path,
        }, href)
      : null
  ), [meta.commitSha, meta.owner, meta.repo, readme]);

  const loading = snapshot === null && loadError === null;
  const crumbs = selectedPath ? repoBreadcrumb(selectedPath) : [];
  const langColor = meta.primaryLanguage ? languageColor(meta.primaryLanguage) : null;

  return (
    // The section is a keyboard host, not a widget: it carries the modal's
    // shortcut layer while every actual control inside it stays focusable.
    <section
      className="research-gh"
      aria-label={`${slug} repository snapshot`}
      onKeyDown={onKeyDown}
    >
      <header className="research-gh__head">
        <span className="research-gh__glow" aria-hidden />
        <div className="research-gh__identity">
          <span className="research-gh__glyph" aria-hidden>
            <Icon name="ph:github-logo" width={22} height={22} />
          </span>
          <div className="research-gh__naming">
            {/* The overlay dialog labels itself with this id. The generic
                header that used to own it is not rendered for a repository, so
                the slug carries it — otherwise the modal's accessible name is
                a dangling reference. */}
            <h3 id="research-res-overlay-title" className="research-gh__slug" title={slug}>
              {slug}
            </h3>
            {meta.description ? (
              <p className="research-gh__description" title={meta.description}>
                {meta.description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="research-gh__icon-btn focus-ring"
            onClick={onClose}
            aria-label="Close repository snapshot"
            title="Close  Esc"
          >
            <Icon name="ph:x" width={15} height={15} aria-hidden />
          </button>
        </div>

        {/* One quiet line: where it points, what it is, how it's doing. No
            pills — chrome here marks exceptions, not facts. */}
        <div className="research-gh__meta">
          <button
            type="button"
            className="research-gh__meta-url focus-ring"
            data-copied={flash === "url" || undefined}
            onClick={copyRepoUrl}
            title="Copy repository URL  ⌘⇧U"
          >
            <span>{flash === "url" ? "Copied" : repoUrl.replace(/^https:\/\//, "")}</span>
            <Icon name={flash === "url" ? "ph:check" : "ph:copy"} width={11} height={11} aria-hidden />
          </button>

          <span className="research-gh__dot" aria-hidden>·</span>
          <button
            type="button"
            className="research-gh__commit focus-ring"
            data-copied={flash === "sha" || undefined}
            onClick={copyCommitSha}
            title={`Captured commit ${meta.commitSha}, resolved from ${meta.resolvedRef}. Click to copy.`}
          >
            <span className="research-gh__commit-dot" aria-hidden />
            {flash === "sha" ? "Copied" : (
              <>
                {shortSha}
                <span className="research-gh__commit-sep" aria-hidden>/</span>
                {meta.resolvedRef}
              </>
            )}
          </button>

          <span className="research-gh__dot" aria-hidden>·</span>
          <span className="research-gh__meta-item">
            captured <RelativeTime iso={meta.fetchedAt} fallback="recently" />
          </span>

          {meta.primaryLanguage ? (
            <>
              <span className="research-gh__dot" aria-hidden>·</span>
              <span className="research-gh__meta-item research-gh__meta-item--strong">
                <span
                  className="research-gh__lang-dot"
                  aria-hidden
                  style={langColor ? { background: langColor } : undefined}
                />
                {meta.primaryLanguage}
              </span>
            </>
          ) : null}

          {meta.licenseSpdx ? (
            <>
              <span className="research-gh__dot" aria-hidden>·</span>
              <span className="research-gh__meta-item">{meta.licenseSpdx}</span>
            </>
          ) : null}

          {/* `public` is the default, so its absence is the information. Only
              an exception earns the modal's one bordered pill. */}
          {meta.visibility !== "public" ? (
            <span className="research-gh__exception">{meta.visibility}</span>
          ) : null}

          <span className="research-gh__metrics">
            <span title={`${meta.stars.toLocaleString()} stars`}>
              <Icon name="ph:star" width={12} height={12} aria-hidden />
              {meta.stars.toLocaleString()}
              <span className="sr-only"> stars</span>
            </span>
            <span title={`${meta.forks.toLocaleString()} forks`}>
              <Icon name="ph:git-fork" width={12} height={12} aria-hidden />
              {meta.forks.toLocaleString()}
              <span className="sr-only"> forks</span>
            </span>
          </span>
        </div>
      </header>

      <div className="research-gh__rule" aria-hidden />

      <div className="research-gh__workspace">
        {railOpen ? (
          <nav className="research-gh__rail" aria-label="Repository files">
            <button
              type="button"
              className="research-gh__rail-head focus-ring"
              onClick={() => setRailOpen(false)}
              title="Hide file browser  ⌘\"
            >
              <span>File browser</span>
              <Icon name="ph:sidebar-simple" width={12} height={12} aria-hidden />
            </button>

            <div className="research-gh__filter">
              <Icon name="ph:magnifying-glass" width={13} height={13} aria-hidden />
              <input
                ref={filterRef}
                type="text"
                className="focus-ring"
                value={filter}
                disabled={!snapshot}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={
                  snapshot ? `Filter ${fileCount} files` : "Filter files"
                }
                aria-label="Filter repository files"
              />
              {filtering ? (
                <button
                  type="button"
                  className="research-gh__filter-clear focus-ring"
                  onClick={() => setFilter("")}
                  aria-label="Clear filter"
                  title="Clear  Esc"
                >
                  <Icon name="ph:x" width={10} height={10} aria-hidden />
                </button>
              ) : (
                <kbd className="research-gh__kbd" aria-hidden>/</kbd>
              )}
            </div>

            {snapshot?.truncated ? (
              <div className="research-gh__truncated" role="status">
                <Icon name="ph:warning" width={12} height={12} aria-hidden />
                <div>
                  <span>
                    Showing {fileCount.toLocaleString()} files. GitHub truncated this
                    tree at capture.
                  </span>
                  <button
                    type="button"
                    className="research-gh__link-btn focus-ring"
                    onClick={() => openUrl(githubRepoTreeWebUrl(meta.owner, meta.repo, meta.commitSha))}
                  >
                    Browse the rest on GitHub →
                  </button>
                </div>
              </div>
            ) : null}

            <div className="research-gh__tree" data-scroll ref={treeRef} onKeyDown={onTreeKeyDown}>
              {loading ? (
                // The eleven bar widths are a fixed decorative pattern, not a
                // measurement, so the sheet owns them through :nth-child.
                <ul className="research-gh__skeletons" aria-hidden>
                  {Array.from({ length: 11 }, (_, index) => (
                    <li key={index}>
                      <span className="research-gh__sk-icon" />
                      <span className="research-gh__sk-bar" />
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  {readme && !filtering ? (
                    <>
                      <button
                        type="button"
                        className="research-gh__row research-gh__row--readme focus-ring"
                        data-selected={showingReadme || undefined}
                        onClick={selectReadme}
                        title={readme.path}
                      >
                        <span className="research-gh__row-bar" aria-hidden />
                        <span className="research-gh__row-icon">
                          <Icon name="ph:book-open" width={14} height={14} aria-hidden />
                        </span>
                        <span className="research-gh__row-name">Readme</span>
                        <span className="research-gh__row-size">{readmeSize}</span>
                      </button>
                      <div className="research-gh__row-divider" aria-hidden />
                    </>
                  ) : null}

                  {rows.length > 0 ? (
                    <div role="tree" aria-label="Repository tree">
                      {rows.map((entry, index) => {
                        const node = entry.kind === "hit" ? entry.node : entry.row.node;
                        const isDir = node.type === "tree";
                        const selected = node.path === selectedPath;
                        const size = entry.kind === "hit"
                          ? formatGithubBytes(node.size) ?? ""
                          : repoRowSizeLabel(node);
                        return (
                          <button
                            key={entry.key}
                            type="button"
                            role="treeitem"
                            aria-level={entry.kind === "tree" ? entry.row.depth + 1 : 1}
                            aria-selected={selected}
                            aria-expanded={isDir ? entry.kind === "tree" && entry.row.expanded : undefined}
                            data-row-index={index}
                            tabIndex={index === activeRow ? 0 : -1}
                            className="research-gh__row"
                            data-selected={selected || undefined}
                            data-dir={isDir || undefined}
                            title={node.path}
                            onFocus={() => setActiveRow(index)}
                            onClick={() => { setActiveRow(index); activateRow(entry); }}
                          >
                            <span className="research-gh__row-bar" aria-hidden />
                            {entry.kind === "tree"
                              ? Array.from({ length: entry.row.indent }, (_, rail) => (
                                  <span key={rail} className="research-gh__row-rail" aria-hidden />
                                ))
                              : null}
                            <span className="research-gh__row-icon">
                              <Icon
                                name={
                                  isDir
                                    ? (entry.kind === "tree" && entry.row.expanded
                                        ? "ph:folder-open"
                                        : "ph:folder")
                                    : fileIconName(node.path)
                                }
                                width={13}
                                height={13}
                                aria-hidden
                              />
                            </span>
                            <span className="research-gh__row-name">{node.name}</span>
                            {entry.kind === "hit" && entry.dir ? (
                              <span className="research-gh__row-dir">{entry.dir}</span>
                            ) : null}
                            {fileState.kind === "loading" && fileState.path === node.path ? (
                              <span className="research-gh__row-spinner" aria-hidden />
                            ) : size ? (
                              <span className="research-gh__row-size">{size}</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : filtering ? (
                    <div className="research-gh__no-results">
                      <span>Nothing matches “{filter.trim()}”</span>
                      <button
                        type="button"
                        className="research-gh__link-btn focus-ring"
                        onClick={() => setFilter("")}
                      >
                        Clear filter
                      </button>
                    </div>
                  ) : (
                    <p className="research-gh__no-results">
                      <span>This snapshot has no files.</span>
                    </p>
                  )}
                </>
              )}
            </div>
          </nav>
        ) : (
          <button
            type="button"
            className="research-gh__rail-stub focus-ring"
            onClick={() => setRailOpen(true)}
            title="Show file browser  ⌘\"
          >
            <Icon name="ph:sidebar-simple" width={15} height={15} aria-hidden />
            <span className="research-gh__rail-stub-label">File browser</span>
            {snapshot ? <span className="research-gh__rail-stub-count">{fileCount}</span> : null}
          </button>
        )}

        <article className="research-gh__pane">
          <div className="research-gh__toolbar">
            <div className="research-gh__crumbs">
              {loading ? (
                <span className="research-gh__sk-bar research-gh__sk-crumb" aria-hidden />
              ) : selectedPath ? (
                crumbs.map((crumb, index) => (
                  <span key={crumb.key} className="research-gh__crumb-group">
                    {index > 0 ? <span className="research-gh__crumb-sep" aria-hidden>/</span> : null}
                    {crumb.path && index < crumbs.length - 1 ? (
                      <button
                        type="button"
                        className="research-gh__crumb focus-ring"
                        title={crumb.path}
                        onClick={() => revealPath(crumb.path!)}
                      >
                        {crumb.name}
                      </button>
                    ) : (
                      <span
                        className="research-gh__crumb"
                        data-current={index === crumbs.length - 1 || undefined}
                        title={selectedPath}
                      >
                        {crumb.name}
                      </span>
                    )}
                  </span>
                ))
              ) : (
                <span className="research-gh__crumb" data-current>
                  {readme ? "Readme" : "Repository snapshot"}
                </span>
              )}
            </div>
            <div className="research-gh__toolbar-actions">
              <button
                type="button"
                className="research-gh__tool focus-ring"
                data-copied={flash === "path" || undefined}
                onClick={copySelectionPath}
                title="Copy path  ⌘⇧C"
              >
                <Icon name={flash === "path" ? "ph:check" : "ph:copy"} width={12} height={12} aria-hidden />
                {flash === "path" ? "Copied" : "Path"}
              </button>
              {fileState.kind === "ready" && fileState.path === selectedPath ? (
                <button
                  type="button"
                  className="research-gh__tool focus-ring"
                  data-on={wrap || undefined}
                  aria-pressed={wrap}
                  onClick={() => setWrap((current) => !current)}
                  title="Soft wrap  ⌥Z"
                >
                  <Icon name="ph:text-align-left" width={12} height={12} aria-hidden />
                  Wrap
                </button>
              ) : null}
            </div>
          </div>

          <div className="research-gh__content" data-scroll>
            {loadError ? (
              <div className="research-gh__band research-gh__band--error" role="alert">
                <p>{loadError}</p>
                <Button size="xs" variant="ghost" onClick={onRetryLoad}>Retry</Button>
              </div>
            ) : loading ? (
              <div className="research-gh__restoring" role="status">
                <span className="research-gh__restoring-mark" aria-hidden>
                  <Icon name="ph:git-commit" width={20} height={20} />
                </span>
                <strong>Restoring the snapshot at {shortSha}</strong>
                <span>Reading the captured entries</span>
              </div>
            ) : showingReadme ? (
              readme ? (
                <MarkdownBlock
                  text={readme.markdown}
                  className="research-gh__markdown cave-md--expanded cave-md--reader"
                  onOpenUrl={openUrl}
                  resolveOpenUrl={resolveReadmeUrl}
                  stripLayoutHtml
                  suppressRemoteMedia
                />
              ) : (
                <div className="research-gh__empty">
                  <Icon name="ph:book-open" width={26} height={26} aria-hidden />
                  <strong>No README in this snapshot</strong>
                  <span>Pick a file from the rail to read it.</span>
                </div>
              )
            ) : selectedNode && !repoFileIsPreviewable(selectedNode.path, selectedNode.size) ? (
              <div className="research-gh__empty">
                <Icon
                  name={repoFileKind(selectedNode.path) === "image" ? "ph:image" : "ph:file-x"}
                  width={26}
                  height={26}
                  aria-hidden
                />
                <strong>
                  {repoFileKind(selectedNode.path) === "text"
                    ? `${formatGithubBytes(selectedNode.size) ?? "This file"} — too large to preview`
                    : `${(selectedNode.path.split(".").at(-1) ?? "").toUpperCase()}${
                        formatGithubBytes(selectedNode.size)
                          ? ` · ${formatGithubBytes(selectedNode.size)}`
                          : ""
                      } — not previewable in Cave`}
                </strong>
                <span>
                  {repoFileKind(selectedNode.path) === "text"
                    ? `Cave previews files under ${formatGithubBytes(REPO_FILE_PREVIEW_BYTE_LIMIT)}.`
                    : "Cave keeps captured snapshots text-only."}
                </span>
                <Button
                  size="xs"
                  variant="secondary"
                  trailingIcon="ph:arrow-up-right"
                  onClick={() => openUrl(primaryUrl)}
                >
                  Open on GitHub
                </Button>
              </div>
            ) : fileState.kind === "loading" && fileState.path === selectedPath ? (
              <div className="research-gh__code-skeleton" aria-hidden>
                {Array.from({ length: 12 }, (_, index) => (
                  <span key={index} className="research-gh__sk-bar" />
                ))}
              </div>
            ) : fileState.kind === "error" && fileState.path === selectedPath ? (
              <div className="research-gh__band research-gh__band--error" role="alert">
                <p>{fileState.message}</p>
                {selectedNode ? (
                  <Button size="xs" variant="ghost" onClick={() => void loadFile(selectedNode)}>
                    Retry
                  </Button>
                ) : null}
              </div>
            ) : fileState.kind === "ready" && fileState.path === selectedPath ? (
              <div className="research-gh__source" data-wrap={wrap || undefined}>
                {fileState.file.text.split("\n").map((line, index) => (
                  <div className="research-gh__line" key={index}>
                    <span className="research-gh__line-no" aria-hidden>{index + 1}</span>
                    <span className="research-gh__line-text">{line === "" ? " " : line}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="research-gh__empty">
                <Icon name="ph:tree-structure" width={26} height={26} aria-hidden />
                <strong>Pick a file from the rail</strong>
                <span>Its captured blob opens here at {shortSha}.</span>
              </div>
            )}
          </div>
        </article>
      </div>

      <div className="research-gh__rule" aria-hidden />

      <footer className="research-gh__actions">
        <div className="research-gh__actions-left">{removeSlot}</div>
        <div className="research-gh__actions-right" ref={overflowRef}>
          {overflowOpen ? (
            <div className="research-gh__overflow" role="menu">
              <button
                type="button"
                role="menuitem"
                className="focus-ring"
                onClick={() => { setOverflowOpen(false); onPreviewInBrowser(); }}
              >
                <Icon name="ph:globe" width={14} height={14} aria-hidden />
                <span>Preview in browser</span>
                <kbd>⌘B</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                className="focus-ring"
                onClick={() => { setOverflowOpen(false); copyRepoUrl(); }}
              >
                <Icon name="ph:link-simple" width={14} height={14} aria-hidden />
                <span>Copy repo URL</span>
                <kbd>⌘⇧U</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                className="focus-ring"
                onClick={() => {
                  setOverflowOpen(false);
                  openUrl(githubRepoTreeWebUrl(meta.owner, meta.repo, meta.commitSha));
                }}
              >
                <Icon name="ph:tree-structure" width={14} height={14} aria-hidden />
                <span>Open captured tree</span>
                <kbd />
              </button>
              <button
                type="button"
                role="menuitem"
                className="focus-ring"
                onClick={() => { setOverflowOpen(false); setHelpOpen(true); }}
              >
                <Icon name="ph:keyboard" width={14} height={14} aria-hidden />
                <span>Keyboard shortcuts</span>
                <kbd>?</kbd>
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="research-gh__icon-btn focus-ring"
            data-on={overflowOpen || undefined}
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            aria-label="More actions"
            title="More"
            onClick={() => setOverflowOpen((open) => !open)}
          >
            <Icon name="ph:dots-three" width={16} height={16} aria-hidden />
          </button>
          {addToRunSlot}
          <button
            type="button"
            className="research-gh__primary focus-ring"
            onClick={() => openUrl(primaryUrl)}
            title={primaryTitle}
          >
            <span>{primaryLabel}</span>
            <Icon name="ph:arrow-up-right" width={13} height={13} aria-hidden />
          </button>
        </div>
      </footer>

      {helpOpen ? (
        <div
          ref={helpRef}
          className="research-gh__help"
          role="dialog"
          aria-modal="true"
          aria-labelledby={helpTitleId}
          tabIndex={-1}
          onClick={() => setHelpOpen(false)}
        >
          <div className="research-gh__help-card" onClick={(event) => event.stopPropagation()}>
            <div className="research-gh__help-head">
              <h4 id={helpTitleId}>Keyboard</h4>
              <span>Esc to dismiss</span>
            </div>
            <dl className="research-gh__help-grid">
              {SHORTCUTS.map((shortcut) => (
                <div key={shortcut.label}>
                  <dt>{shortcut.label}</dt>
                  <dd><kbd>{shortcut.keys}</kbd></dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      ) : null}
    </section>
  );
}
