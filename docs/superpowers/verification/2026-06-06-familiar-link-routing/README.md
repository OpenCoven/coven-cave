# Smoke verification — familiar link routing

Live captures from `pnpm dev` (with `NEXT_PUBLIC_DEMO=true`) against the implementation that landed for `docs/superpowers/specs/2026-06-06-familiar-link-routing-design.md`. Captures driven by `scripts/capture-library-smoke.mjs`.

The smoke also exercised every classifier tier via direct POSTs to `/api/library/route-link`:

| URL | Tier hit | Resulting list | Source recorded |
|---|---|---|---|
| `https://github.com/OpenCoven/coven-cave/pull/179` | `github` | github.json (`kind: pr`, `number: 179`) | `slash` |
| `https://arxiv.org/abs/2603.12345` | `paper-host` | reading.json (`sourceType: paper`) | `chat "Phase 2A relay PR"` (with sessionId + turnId) |
| `https://blog.cloudflare.com/relay-routing` | `article-host` | reading.json (`sourceType: article`, title "Relay Routing") | `browser` (Save button) |
| `https://docs.python.org/3/` | `default-bookmark` | bookmarks.json | `slash` |
| `https://twitter.com/foo/status/1` | `familiar-fallback` | bookmarks.json (per documented Phase-7 gap), badge reads "Cody guessed" | `slash` |
| `https://github.com/…/pull/1` + `listHint: "bookmarks"` | hint override | bookmarks.json (no `kind` field) | `slash` |

Other behaviors verified live:
- Re-POSTing the same `(url, sessionId, turnId)` triple returns `deduped: true` (idempotent).
- `"not-a-url"` returns HTTP 400 `error: "invalid_url"`.
- `GET /api/library/all` returns all 6 entries sorted by `capturedAt` desc.
- `GET /api/library/all?familiar=cody` returns 5 entries (Sage's arxiv excluded).
- `LibraryView` lands on the new `"all"` section by default (the LibraryTimeline renders first).
- Group toggle flips between "Group: date" and "Group: source"; under source-grouping the headers cluster items by their `source.kind` (4 under `/save`, 1 under `Save button`, 1 under `chat "Phase 2A relay PR" · sage`).

## Captures

1. **`01-library-all-default-date-group.png`** — Library / All tab, default state. Six entries grouped under "TODAY · 6 links". Each row shows the list icon, title, familiar attribution, source pill, classifier-rule badge, and relative time.
2. **`02-library-all-grouped-by-source.png`** — Same data, Group toggle flipped to "source". Three source groups: `/save · 4 links`, `Save button · 1 link`, `chat "Phase 2A relay PR" · sage · 1 link`.

## Reproducing

```bash
NEXT_PUBLIC_DEMO=true pnpm dev &
# Wait for ready
# Seed 6 entries via direct POSTs (see commit message for the curl block)
node scripts/capture-library-smoke.mjs   # outputs to /tmp/library-all-*.png
```
