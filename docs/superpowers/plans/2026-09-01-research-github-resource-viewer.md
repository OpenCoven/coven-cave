# Saved GitHub resource viewer implementation plan

> **Status: Shipped.** Merged in [#5287](https://github.com/OpenCoven/coven-cave/pull/5287)
> on 2026-09-02 as `6a457a82fb3832224b11f16c5531ac413ae38fa6`.
> Checkbox state is not used; the completion evidence below is authoritative.

**Goal:** Make a saved GitHub repository URL ingest and open like a
source-native Research Desk resource.

**Spec:** `docs/superpowers/specs/2026-09-01-research-github-resource-viewer-design.md`  
**Bead:** `cave-zl52y`

## 1. Freeze and fetch a repository snapshot

- Extend the shared GitHub repository contract with exact commit and blob SHAs
  plus bounded display metadata.
- Upgrade the server transport to GitHub REST `2026-03-10`.
- Resolve the requested/default ref to a commit before fetching tree/README.
- Add bounded raw text-blob fetching by exact blob SHA.
- Cover success, malformed upstream data, binary/oversized blobs, access
  denial, missing refs, and network failure.

## 2. Persist GitHub enrichment during save

- Add `githubRepo` to `SavedLink` and a list-safe summary shape.
- Validate the full snapshot at the strict legacy-store boundary.
- Reuse the compatibility manifest's `legacySavedLink` extension channel.
- Enrich at most five distinct repositories serially during link save.
- Degrade GitHub failures to the existing generic GitHub saved link.
- Prove list responses omit tree/README and detail responses retain them.

## 3. Replace the disconnected browser with a saved-resource viewer

- Remove the standalone repository input from the Resources tab.
- Refactor the viewer to consume one persisted repository snapshot.
- Add two-pane tree/reader layout, commit provenance, README default, and
  in-Cave text-file reading.
- Load full GitHub detail automatically when its saved card opens.
- Keep explicit GitHub/browser links and current overlay actions.

## 4. Verify the authoritative behavior

- Run focused pure, server, route, storage, compatibility, and rendered-surface
  tests.
- Run the Research Resources behavior test.
- Run design token/reference checks and TypeScript.
- Exercise a production-path save/detail/blob/view flow with mocked GitHub
  transport and persisted snapshot evidence.
- Inspect the final diff and classify every requested deliverable.

## Completion evidence

- Bead `cave-zl52y` is closed with the PR head
  `d09c893748b2b9f4c8847c1d9199490ae77fac07` and merge commit above recorded
  in its closure evidence.
- The shipped flow persists exact commit and blob provenance, projects a
  list-safe summary, enriches at most five repositories serially, preserves the
  compatibility extension channel, and opens the saved resource directly in
  the two-pane viewer.
- Focused evidence lives in
  `src/lib/research-github-repo.test.ts`,
  `src/lib/server/research-github-repo.test.ts`,
  `src/components/role-surfaces/research-github-repo-viewer.test.tsx`, and
  `tests/research-github-resource-viewer.spec.ts`.
- Review hardening added anonymous fallback for public GitHub reads when
  credential resolution fails and fixed commit-aware markdown-link handling;
  neither changed the plan's product scope.
