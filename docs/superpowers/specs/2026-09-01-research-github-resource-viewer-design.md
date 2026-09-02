# Research Desk: saved GitHub resource ingestion and repository viewer

**Bead:** `cave-zl52y`  
**Date:** 2026-09-01  
**Status:** implementation approved by the originating request

## Problem

The Research Desk already groups GitHub URLs as saved resources, but those
rows retain only URL-derived metadata. A separate manual repository browser
can fetch a README and file tree, yet it is disconnected from saved resources:
the operator must re-enter a repository, the result is not pinned to the saved
resource, and selecting a file leaves Cave.

Articles and papers establish the intended product pattern:

1. recognize a supported URL during save;
2. enrich and persist bounded source-specific metadata;
3. keep collection responses small by withholding large bodies;
4. load the full saved detail only when its reader opens;
5. render a dedicated, source-native viewer inside the resource overlay.

GitHub resources should follow that pattern.

## Product outcome

When Val saves a `github.com/{owner}/{repo}` URL, including a deeper URL inside
that repository, Cave captures a bounded repository snapshot at the resolved
default-branch commit. Opening the saved resource enters a dedicated GitHub
viewer with:

- repository identity and description;
- primary language, license, stars, and forks;
- exact commit provenance and snapshot time;
- the saved README;
- a bounded recursive file tree;
- on-demand in-Cave reading for text blobs at the captured blob SHA;
- explicit links back to the captured file or tree on GitHub.

If GitHub enrichment is unavailable, the URL still saves with today's generic
GitHub behavior. Private repository access continues to use Cave's configured
server-side GitHub credential; the browser never receives a token.

## Feasibility evidence

### Current GitHub transport

GitHub's current REST version is `2026-03-10`; requests opt into it with
`X-GitHub-Api-Version`. The recursive Git Trees endpoint returns paths, object
types, sizes, and blob SHAs, while the Git Blobs endpoint returns raw content
with `application/vnd.github.raw+json`.

On 2026-09-01, a live authenticated probe against
`OpenCoven/coven-cave@3795e144c8c03b30a475f92ae36729ea57bfb191`
returned:

- 7,957 recursive tree entries without GitHub-side truncation;
- `README.md` as blob `6a9ea91371652e46932891a5283a89f467030566`;
- raw README bytes from that blob using the current API version.

The existing Cave route already proves the local-only request guard,
`resolveGitHubToken`, bounded tree/README handling, and browser-safe wire
contract.

### Technology choice

Use the versioned GitHub REST Git-object APIs in the Cave server:

- repository metadata for stable display fields;
- commit resolution to freeze a branch at one exact OID;
- recursive tree retrieval for one bounded directory model;
- README retrieval pinned to the exact commit;
- raw blob retrieval by SHA for explicit file reads.

Do not make GitHub MCP Server or GitHub CLI a runtime dependency. Both are
strong modern precedents for remote repository reading, but MCP introduces a
second OAuth/tool protocol and the CLI introduces a host binary/version
dependency. Cave already has the narrower server-side credential boundary and
needs deterministic UI payloads, not agent tools.

### Limits

- At most five distinct repositories are enriched in one save request.
- Persist at most 400 tree entries and 256 KiB of README Markdown.
- Persist at most 512 KiB for the complete serialized repository snapshot,
  leaving headroom beneath the resource manifest's 1 MiB record ceiling.
- Preview text blobs only, at most 1 MiB.
- Validate every stored field at the user-editable disk boundary.
- Store the exact commit and blob SHAs; never read a moving branch after save.
- Degrade enrichment failures to a normal saved GitHub link.

## Data model

`SavedLink` gains an optional `githubRepo` block:

```ts
type GithubRepoSnapshot = {
  version: 1;
  owner: string;
  repo: string;
  defaultBranch: string;
  resolvedRef: string;
  commitSha: string;
  description?: string;
  primaryLanguage?: string;
  licenseSpdx?: string;
  visibility: "public" | "private" | "internal";
  stars: number;
  forks: number;
  fetchedAt: string;
  truncated: boolean;
  tree: Array<{ path: string; type: "blob" | "tree"; sha: string; size?: number }>;
  readme: { path: string; markdown: string } | null;
};
```

List responses omit `tree` and `readme`; detail responses retain them. The
compatibility manifest stores the full snapshot under
`legacySavedLink.caveGithubRepoV1`, matching the existing X Article projection
pattern without teaching the generic resource manifest about repository
internals.

## Interaction

The disconnected repository form is removed from the Resources page.

Opening a saved GitHub card loads its local detail and displays the repository
viewer automatically. The tree and README are local saved data. Choosing a text
file performs one explicit, loopback-only blob request and swaps the reading
pane from README to that file. Binary or oversized blobs get a specific
non-previewable state and retain the GitHub link.

## Visual direction

### Palette and type

Use Cave's semantic tokens rather than introducing literal colors:

- `--bg-base`, `--bg-raised`, and `--bg-sunken` for repository depth;
- `--border-hairline` and `--border-strong` for the tree/reader boundary;
- `--accent-presence` only for the captured-commit marker;
- `--text-primary`, `--text-secondary`, and `--text-muted` for hierarchy.

EB Garamond is confined to the repository title, Inter carries controls and
reading copy, and JetBrains Mono carries paths, refs, SHAs, and source text.

### Layout

Wide:

```text
┌ repository identity ─────────── captured commit provenance ┐
├ file tree (280px) ┬ README or selected text file           ┤
│ collapsible paths │ path / bytes / open on GitHub          │
│                   │ scrollable source reading surface      │
└───────────────────┴────────────────────────────────────────┘
```

Narrow:

```text
┌ repository identity + provenance ┐
├ collapsible file tree             ┤
├ README or selected file           ┤
└───────────────────────────────────┘
```

### Signature

The commit provenance rail is the one expressive element: a small live-colored
capture point connected to exact SHA, branch, and captured timestamp. It makes
the repository's immutable reading context visible instead of decorating the
surface with generic code motifs.

### Self-critique

An initial concept used a terminal-green code surface and graph-node
background. That is generic developer-tool styling and would conflict with
Cave's theme matrix. The accepted direction keeps code on the existing fixed
ink surface and spends visual emphasis only on the immutable provenance rail.

## Accessibility and behavior

- All interactive rows use `.focus-ring`.
- File selection is represented with `aria-current`.
- Loading and failures use status/alert semantics and mutation announcements.
- File reads are cancellable by request generation so stale responses cannot
  replace a newer selection.
- The global reduced-motion contract is sufficient; the viewer adds no
  continuous animation.
- Color is never the only provenance or selection signal.

## Acceptance criteria

1. Saving a GitHub repository URL persists one bounded `githubRepo` snapshot
   pinned to an exact commit.
2. Saved-link list responses expose summary metadata but not tree or README
   bodies.
3. Opening that saved card renders the dedicated viewer from persisted detail.
4. Selecting a text file reads the exact captured blob in Cave.
5. No GitHub token reaches client code.
6. Malformed stored snapshots are rejected at the durable boundary.
7. GitHub enrichment failure preserves generic saved-link behavior.
8. Existing article, paper, X Article, generic-link, and local-resource behavior
   remains unchanged.

## Sources

- GitHub REST API versions:
  https://docs.github.com/en/rest/about-the-rest-api/api-versions
- Git Trees:
  https://docs.github.com/en/rest/git/trees
- Git Blobs:
  https://docs.github.com/en/rest/git/blobs
- Repository contents:
  https://docs.github.com/en/rest/repos/contents
- REST best practices:
  https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
- Remote GitHub MCP Server:
  https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md
- GitHub CLI remote repository reads:
  https://github.blog/changelog/2026-06-17-read-remote-repository-content-with-github-cli/
