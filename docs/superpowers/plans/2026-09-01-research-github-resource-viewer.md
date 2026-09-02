# Saved GitHub resource viewer implementation plan

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
