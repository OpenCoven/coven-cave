# Home route JavaScript budget

The Cave opens on Chat, so the initial `/` graph should contain the shell and
the Sessions conversation path. Workspace modes, alternate Chat tabs, the code
rail, and modal hosts load on first use through
`src/components/lazy-surfaces.tsx`.

## Measurement

Next 16 writes the complete App Router first-load graph to
`.next/diagnostics/route-bundle-stats.json`. `scripts/bundle-budget.mjs` reads
the `/` row after every production build and fails above **2,800 KiB**. The
budget includes page and layout entries plus the shared root chunks; it is more
complete than the old `build-manifest.rootMainFiles` total.

Reproduce the measurement with:

```bash
pnpm build
node scripts/bundle-budget.mjs
```

Generate the Turbopack module graph when a regression needs attribution:

```bash
pnpm analyze:bundle
```

The interactive report is written to `.next/diagnostics/analyze/`. The #3262
verification run completed successfully against the after-build graph.

## #3262 evidence

Measured on the same Linux/WSL toolchain from `origin/main` at `d5ed41b` and
the #3262 branch:

| Graph | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| `/` page entry only | 4,335,119 B / 23 chunks | 1,991,068 B / 13 chunks | 54.1% |
| Complete `/` first load | 4,796,271 B / 30 chunks | 2,452,293 B / 20 chunks | 48.9% |

The largest remaining eager chunk is the 638,871-byte glyph catalog tracked by
#3263. The Sessions conversation remains eager; Projects, Canvas, Familiar,
Settings, Group Chat, and the code rail now show the shared surface skeleton
while their packaged local chunks load. Because those chunks ship inside the
standalone Next bundle and are served by the local sidecar, the split does not
introduce an internet dependency in the desktop app.
