"use client";

/**
 * ResearchGithubRepoViewer — browse a GitHub repository inside the Research
 * Desk Resources tab (cave-vy5vp).
 *
 * Input is a repository reference (bare `owner/name` or a github.com URL) plus
 * an optional branch; output is the repository's recursive file tree and its
 * README rendered as markdown. The fetch is deliberately opt-in: nothing
 * touches the network until the operator presses "Load repository", which is
 * the remote-content consent surface for this feature — the same explicit,
 * user-triggered pattern the paper reader ("Read paper") and X sources use.
 * The server route (`/api/research/github-repo`) is loopback-only and resolves
 * the configured GitHub credential itself; this component never sees a token.
 */

import { useRef, useState, type FormEvent } from "react";
import { MarkdownBlock } from "@/components/message-bubble";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { Icon } from "@/lib/icon";
import {
  buildGithubRepoTree,
  formatGithubBytes,
  githubRepoFileWebUrl,
  githubRepoTreeWebUrl,
  githubRepoViewEndpoint,
  parseGithubRepoInput,
  sanitizeGithubRef,
  type GithubRepoView,
  type RepoTreeNode,
} from "@/lib/research-github-repo";

export type ResearchGithubRepoViewerProps = {
  /** Open a URL in the Cave's in-app browser (from the surface context). */
  openUrl: (url: string) => void;
};

type ViewerStatus = "idle" | "loading" | "ready" | "error";

function fileIconName(path: string): "ph:file-code" | "ph:file-text" {
  return /\.[cm]?[jt]sx?$|\.(?:json|md|mdx|yaml|yml|toml|css|html|rs|go|py|rb)$/i.test(path)
    ? "ph:file-code"
    : "ph:file-text";
}

function FileTreeNode({
  node,
  owner,
  repo,
  ref,
  openUrl,
}: {
  node: RepoTreeNode;
  owner: string;
  repo: string;
  ref: string;
  openUrl: (url: string) => void;
}) {
  if (node.type === "tree") {
    return (
      <li className="research-gh__node">
        <details className="research-gh__dir">
          <summary className="research-gh__dir-summary focus-ring">
            <Icon name="ph:folder" width={13} height={13} aria-hidden />
            <span>{node.name}</span>
            <span className="sr-only"> folder</span>
          </summary>
          <ul className="research-gh__children">
            {(node.children ?? []).map((child) => (
              <FileTreeNode key={child.path} node={child} owner={owner} repo={repo} ref={ref} openUrl={openUrl} />
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
        onClick={() => openUrl(githubRepoFileWebUrl(owner, repo, ref, node.path))}
        title={`Open ${node.path} on GitHub`}
      >
        <Icon name={fileIconName(node.path)} width={13} height={13} aria-hidden />
        <span className="research-gh__file-name">{node.name}</span>
        {size ? <span className="research-gh__file-size">{size}</span> : null}
        <Icon name="ph:arrow-square-out" width={11} height={11} aria-hidden className="research-gh__file-open" />
      </button>
    </li>
  );
}

export function ResearchGithubRepoViewer({ openUrl }: ResearchGithubRepoViewerProps) {
  const { announce } = useAnnouncer();
  const [repoInput, setRepoInput] = useState("");
  const [refInput, setRefInput] = useState("");
  const [status, setStatus] = useState<ViewerStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<GithubRepoView | null>(null);
  const requestIdRef = useRef(0);

  const loadRepository = async (event: FormEvent) => {
    event.preventDefault();
    if (status === "loading") return;

    const parsed = parseGithubRepoInput(repoInput);
    if (!parsed) {
      setStatus("error");
      setError("Enter a GitHub repository as owner/name or a github.com URL.");
      announce("Enter a GitHub repository as owner/name or a github.com URL.", "assertive");
      return;
    }
    const ref = sanitizeGithubRef(refInput || null);
    if (refInput.trim() && !ref) {
      setStatus("error");
      setError("That branch name can't be used.");
      announce("That branch name can't be used.", "assertive");
      return;
    }

    const requestId = ++requestIdRef.current;
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch(githubRepoViewEndpoint(`${parsed.owner}/${parsed.repo}`, ref));
      const payload = (await response.json().catch(() => null)) as
        | (GithubRepoView & { ok: true })
        | { ok: false; error?: string }
        | null;
      if (requestIdRef.current !== requestId) return;
      if (!response.ok || !payload || payload.ok !== true) {
        setStatus("error");
        setError((payload && "error" in payload && payload.error) || `GitHub couldn't load that repository (${response.status}).`);
        announce("Couldn't load the GitHub repository.", "assertive");
        return;
      }
      setView(payload);
      setStatus("ready");
      announce(`Loaded ${payload.owner}/${payload.repo}.`);
    } catch {
      if (requestIdRef.current !== requestId) return;
      setStatus("error");
      setError("Couldn't reach GitHub. Check your connection and try again.");
      announce("Couldn't reach GitHub.", "assertive");
    }
  };

  const treeUrl = view ? githubRepoTreeWebUrl(view.owner, view.repo, view.resolvedRef) : null;
  const roots = view ? buildGithubRepoTree(view.tree) : [];

  return (
    <section className="research-gh" aria-label="Browse GitHub repository">
      <header className="research-gh__head">
        <div>
          <h3>GitHub repository</h3>
          <p>Browse a repository's files and README. Loads remote content from GitHub on demand.</p>
        </div>
      </header>

      <form className="research-gh__form" onSubmit={loadRepository}>
        <label className="research-gh__field">
          <span>Repository</span>
          <input
            className="focus-ring"
            value={repoInput}
            onChange={(event) => {
              setRepoInput(event.target.value);
              if (status === "error") setStatus("idle");
            }}
            placeholder="owner/name or github.com URL"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
          />
        </label>
        <label className="research-gh__field research-gh__field--ref">
          <span>Branch (optional)</span>
          <input
            className="focus-ring"
            value={refInput}
            onChange={(event) => setRefInput(event.target.value)}
            placeholder="main"
            spellCheck={false}
          />
        </label>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          leadingIcon="ph:github-logo"
          loading={status === "loading"}
          disabled={status === "loading" || !repoInput.trim()}
        >
          {status === "loading" ? "Loading…" : "Load repository"}
        </Button>
      </form>

      {status === "error" && error ? (
        <p className="research-gh__error" role="alert">
          {error}
        </p>
      ) : null}

      {view ? (
        <div className="research-gh__result">
          <header className="research-gh__meta">
            <span className="research-gh__meta-glyph" aria-hidden>
              <Icon name="ph:github-logo" width={16} height={16} />
            </span>
            <div className="research-gh__meta-copy">
              <strong className="research-gh__meta-title">
                {view.owner}/{view.repo}
              </strong>
              <span className="research-gh__meta-branch">
                {view.resolvedRef}
                {view.resolvedRef === view.defaultBranch ? " (default)" : ""}
                {view.truncated ? " · listing truncated" : ""}
              </span>
            </div>
            {treeUrl ? (
              <Button
                size="xs"
                variant="ghost"
                trailingIcon="ph:arrow-square-out"
                onClick={() => openUrl(treeUrl)}
              >
                Open on GitHub
              </Button>
            ) : null}
          </header>

          <section className="research-gh__readme" aria-label="README">
            <header className="research-gh__section-head">
              <h4>README</h4>
              <span className="research-gh__section-sub">
                {view.readme ? view.readme.path : "None"}
              </span>
            </header>
            {view.readme ? (
              <MarkdownBlock
                text={view.readme.markdown}
                className="cave-md--expanded cave-md--reader"
              />
            ) : (
              <p className="research-gh__empty">This repository has no README.</p>
            )}
          </section>

          <section className="research-gh__files" aria-label="Files">
            <header className="research-gh__section-head">
              <h4>Files</h4>
              <span className="research-gh__section-sub">
                {view.tree.length} {view.tree.length === 1 ? "entry" : "entries"}
                {view.truncated ? " (truncated)" : ""}
              </span>
            </header>
            {roots.length === 0 ? (
              <p className="research-gh__empty">This repository has no files at this branch.</p>
            ) : (
              <ul className="research-gh__tree" role="tree" aria-label="Repository files">
                {roots.map((node) => (
                  <FileTreeNode
                    key={node.path}
                    node={node}
                    owner={view.owner}
                    repo={view.repo}
                    ref={view.resolvedRef}
                    openUrl={openUrl}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
