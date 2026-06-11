# Space Hoggers Audit

Date: 2026-06-11

Scope: tracked app/docs files under `src`, `docs`, `README.md`, and `package.json`.

Commands:

```bash
du -ah docs src/components src/lib src/app src/graphify-out README.md package.json | sort -hr | head -80
wc -l src/components/*.tsx src/components/*.ts src/lib/*.ts src/app/**/*.tsx docs/superpowers/plans/*.md docs/audits/assets/chat-ux/* 2>/dev/null | sort -nr | head -80
```

## Summary

The removed 3D memory graph was a low-value, high-cost feature: it consumed a large dedicated component/model/test surface, pulled WebGL semantics into a memory inspector, and still needed special mobile handling. The memory UI is now a list/reader surface only.

The biggest remaining space hog is not runtime UI. It is tracked generated and historical material: `src/graphify-out`, large planning docs, and audit screenshots. Those add some maintainer context, but the value-to-size ratio is weak once the work is shipped.

## Top Hoggers

| Rank | Path | Size / lines | Value | Value vs size | Action |
| --- | --- | ---: | --- | --- | --- |
| 1 | `src/graphify-out/graph.json` | 2.0M | Medium: powers/generated library graph evidence | Weak | Regenerate on demand or move generated output out of tracked source if the API can read an artifact path. |
| 2 | `docs/superpowers/plans` | 1.1M / many 1k-3.8k line plans | Medium-low after implementation | Weak | Archive completed plans outside the repo or compress into short decision records. |
| 3 | `docs/audits/assets/chat-ux` | 996K PNGs | Medium: useful visual audit proof | Weak | Keep only current before/after evidence; archive older screenshot sets. |
| 4 | `src/components/chat-view.tsx` | 140K / 3,520 lines | High: core chat workflow | Mixed | Split transcript, composer, streaming state, and command UI. High product value, poor maintainability density. |
| 5 | `src/app/globals.css` | 132K | High: app-wide styling | Mixed | Break into surface-level CSS modules or grouped imports when touching adjacent UI. |
| 6 | `docs/superpowers/plans/2026-06-08-familiar-studio.md` | 116K / 3,354 lines | Low now that shipped | Weak | Replace with a short post-implementation record if needed. |
| 7 | `docs/superpowers/plans/2026-06-08-ui-ux-shell-ia.md` | 112K / 3,760 lines | Low-medium | Weak | Same archive/compress path as other completed plans. |
| 8 | `src/components/plugins-view.tsx` | 60K / 1,563 lines | Medium-high | Acceptable, trending weak | Split plugin list, detail panel, install flow, and empty/error states. |
| 9 | `src/components/inspector-pane.tsx` | 56K / 1,420 lines | High | Acceptable | Keep, but split by inspector tab on next behavioral change. |
| 10 | `src/components/workspace.tsx` | 52K / 1,427 lines | High | Mixed | Extract shell state/routing glue from presentational layout. |
| 11 | `src/components/trace-graph-3d.tsx` | 32K / 671 lines | Medium: trace/delegation graph can encode route/time data | Acceptable only if actively used | Keep for now; unlike memory, this graph has a clearer structural purpose. |
| 12 | `src/components/agents-memory-view.tsx` | 32K / 660 lines after graph removal | Medium-high | Improved | Now list/reader only. Consider splitting file list, coven list, and drawer later. |

## Removed In This Pass

| Removed surface | Size / lines | Value | Decision |
| --- | ---: | --- | --- |
| `src/components/memory-graph-3d.tsx` | 544 lines | Low | Removed. The spatial layout did not make memory easier to inspect. |
| `src/lib/memory-graph-3d-model.ts` | 524 lines | Low | Removed with the graph. |
| 3D memory graph tests/dev route/smoke | 600+ lines | Low | Removed because they only protected the deleted graph. |
| Memory graph mode/toggle in `AgentsMemoryView` | UI complexity | Low | Removed. Memory is now a single list/reader interaction. |

## Recommended Next Cleanup

1. Decide whether `src/graphify-out` should be tracked. If yes, add a documented regeneration command and refresh it after deleting the memory graph. If no, move it to ignored build output.
2. Convert completed `docs/superpowers/plans/*.md` into short decision records or archive them outside the app repo.
3. Compress or prune old `docs/audits/assets/chat-ux/*.png` evidence once the related audit is closed.
4. Split `src/components/chat-view.tsx` before adding more chat behavior.
