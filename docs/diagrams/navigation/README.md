# CovenCave navigation maps

Source-grounded Mermaid diagrams of the app's navigation IA — the final state
of the simplification tracked in issue
[#3283](https://github.com/OpenCoven/coven-cave/issues/3283). Each `.mmd`
header lists the source files it was read from and the `main` commit it was
regenerated against.

| Map | Covers |
| --- | --- |
| `00-navigation-legend.mmd` | Core semantic palette (shared base node classes/colors); diagrams may define additional per-map classes as needed |
| `01-global-navigation.mmd` | Shell chrome (desktop sidebar + mobile drawer/tabs), route topology, aliases, redirects, dev-only routes |
| `02-workspace-surfaces.mmd` | Every workspace surface `renderSurface` can show, with its internal tabs/panels |
| `03-settings-navigation.mmd` | Settings IA (`settings-sections.ts` sections and nested editors) |
| `04-menus-and-overlays.mmd` | Launchers (⌘K palette, switchers), contextual menus, drawers, dialogs |

## Rendering

Paste a file into <https://mermaid.live>, or render locally:

```bash
pnpm dlx @mermaid-js/mermaid-cli -i docs/diagrams/navigation/01-global-navigation.mmd -o /tmp/nav.svg
```

## Invariants that keep these maps honest

The IA drawn here is pinned by tests, so structural drift fails CI before the
maps go stale:

- **One canonical name per surface** — `src/components/canonical-nav-names.test.ts`
  (sidebar `FOLDER_MODES` is the vocabulary source; workspace titles must match;
  mobile bottom tabs must *derive* from `FOLDER_MODES`, never hand-copy rows).
- **Aliases never render as peer destinations** — `src/lib/workspace-mode.ts`
  (`CANONICAL_WORKSPACE_MODES` + `MODE_ALIASES`) with behavior pinned by
  `src/lib/workspace-mode.test.ts` and `src/components/workspace-alias-modes.test.ts`.
- **Route classification** — `src/app/route-inventory.test.ts` classifies every
  `page.tsx` (workspace / destination / redirect / window-host / dev-only),
  enforces redirect targets, and keeps dev-only routes out of nav hosts.
- **Palette vocabulary** — `src/components/palette-canonical-names.test.ts`.

## Regenerating

There is no generator; the maps are hand-maintained against the sources named
in each file's header. When navigation structure changes: update the affected
map, refresh its `%% Regenerated from` line with the new `main` short SHA, and
keep the legend's class vocabulary (`00-navigation-legend.mmd`) authoritative.
