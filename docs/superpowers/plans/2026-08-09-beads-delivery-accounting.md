# Beads Delivery Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Beads canonical while adding complete desktop delivery accounting, explicit Board-to-Bead links, and read-only linked delivery state in native iOS.

**Architecture:** A pure delivery-normalization module defines safe DTOs and stale/surface rules. Local-only desktop routes can inspect a selected Beads workspace, while the mobile-safe Board delivery route accepts no identifiers and resolves only trusted `beadRef` values already stored on Board cards. Board linking is explicit, locally managed, and protected from routine deletion.

**Tech Stack:** TypeScript 6, Next.js 16 route handlers, React 19, Node 24 scripts/tests, SwiftUI and Swift Codable, Beads CLI through `execFile`.

---

## File map

### New files

- `src/lib/beads-delivery.ts` — pure Beads row types, platform classification, stale classification, overview and linked-card DTO builders.
- `src/lib/beads-delivery.test.ts` — deterministic tests for totals, readiness, surface hygiene, redaction, and stale thresholds.
- `src/lib/server/beads-delivery-source.ts` — trusted workspace loading, bounded `bd list/ready` execution, and short per-project cache.
- `src/app/api/beads/overview/route.ts` — local-only desktop overview endpoint.
- `src/app/api/beads/overview/route.test.ts` — route isolation, failure, and output-bound tests.
- `scripts/beads-create.ts` — canonical `pnpm beads:create` wrapper requiring one platform surface.
- `scripts/beads-create.test.mjs` — wrapper argument and exit-code tests.
- `scripts/beads-surface-audit.ts` — audit new raw-CLI Beads against a generated grandfather baseline.
- `scripts/beads-surface-audit.test.mjs` — baseline and violation-reporting tests.
- `config/beads-surface-grandfather.json` — generated IDs of existing missing/conflicting Beads that remain grandfathered.
- `src/lib/card-bead-ref.ts` — pure `CardBeadRef` normalization and identifier validation.
- `src/lib/card-bead-ref.test.ts` — normalization and malformed legacy data tests.
- `src/lib/server/card-bead-ref.ts` — trusted project/workspace resolution and live Bead validation.
- `src/components/beads-delivery-overview.tsx` — desktop overview band and stale disclosure.
- `src/components/board-bead-field.tsx` — desktop Board inspector link/unlink UI.
- `src/app/api/board/delivery/route.ts` — mobile-safe batch delivery endpoint.
- `src/app/api/board/delivery/route.test.ts` — no-input contract, batching, partial failure, bounds, and redaction tests.
- `apps/ios/CovenCave/CovenCaveTests/BoardDeliveryTests.swift` — Swift decoding and stale-state tests.
- `scripts/ios-board-delivery.test.mjs` — source contract for loading, rendering, failure degradation, and linked-delete UX.

### Modified files

- `package.json` — add `beads:create` and `beads:surfaces` scripts.
- `scripts/run-tests.mjs` — wire every new Node/TypeScript test.
- `docs/workflows/beads-familiars.md` and `AGENTS.md` — make the wrapper and platform labels canonical.
- `src/app/api/beads/route.ts` and `src/app/api/beads/route.test.ts` — enforce `surface` on Cave-created Beads.
- `src/components/familiar-work-queue-view.tsx`, `src/components/familiar-work-queue-view.test.ts`, and `src/styles/familiar-work-queue.css` — load and render the independent overview.
- `src/lib/cave-board-types.ts`, `src/lib/cave-board.ts`, and Board tests — persist normalized `beadRef` and protect linked deletion.
- `src/app/api/board/route.ts` and `src/app/api/board/[id]/route.ts` — local-only `beadRef` mutation and stable delete conflicts.
- `src/app/api/board/[id]/route.test.ts` — local-only link mutation and linked-delete conflict tests.
- `src/components/board-inspector.tsx`, `src/components/board-view.tsx`, and focused Board component tests — link/unlink and preserve linked cards in cleanup.
- `apps/ios/CovenCave/CovenCave/Models/BoardCard.swift` — decode `beadRef` and delivery DTOs.
- `apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift` — fetch batch Board delivery state.
- `apps/ios/CovenCave/CovenCave/State/AppModel.swift` — maintain per-card delivery state alongside tasks.
- `apps/ios/CovenCave/CovenCave/Views/TaskDetailView.swift` — render the read-only Delivery card and suppress linked deletion.

---

### Task 1: Build the pure delivery model

**Files:**
- Create: `src/lib/beads-delivery.ts`
- Create: `src/lib/beads-delivery.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing delivery-model tests**

Create fixtures with one row in every unfinished status, one closed row, rows
with each platform label, one missing label, one conflicting label, and
`in_progress` rows aged 23 hours, 25 hours, and 8 days.

```ts
// src/lib/beads-delivery.test.ts
import assert from "node:assert/strict";
import {
  buildBeadsDeliveryOverview,
  classifyPlatform,
  classifyStale,
  type BeadDeliveryRow,
} from "./beads-delivery.ts";

const now = Date.parse("2026-08-09T12:00:00.000Z");
const row = (patch: Partial<BeadDeliveryRow>): BeadDeliveryRow => ({
  id: "cave-test",
  title: "Test",
  status: "open",
  priority: 2,
  issue_type: "task",
  labels: [],
  updated_at: "2026-08-09T11:00:00.000Z",
  ...patch,
});

assert.equal(classifyPlatform(["surface:ios"]), "ios");
assert.equal(classifyPlatform(["surface:desktop", "surface:chat"]), "desktop");
assert.equal(classifyPlatform(["surface:shared"]), "shared");
assert.equal(classifyPlatform([]), "missing");
assert.equal(classifyPlatform(["surface:ios", "surface:shared"]), "conflicting");
assert.equal(classifyStale(row({ status: "in_progress" }), now), "none");
assert.equal(
  classifyStale(row({ status: "in_progress", updated_at: "2026-08-08T10:59:59.000Z" }), now),
  "older_than_24h",
);
assert.equal(
  classifyStale(row({ status: "in_progress", updated_at: "2026-08-01T11:59:59.000Z" }), now),
  "older_than_7d",
);

const overview = buildBeadsDeliveryOverview(
  [
    row({ id: "open", status: "open", labels: ["surface:shared"] }),
    row({ id: "active", status: "in_progress", labels: ["surface:desktop"], updated_at: "2026-08-08T10:00:00.000Z" }),
    row({ id: "blocked", status: "blocked", labels: ["surface:ios"] }),
    row({ id: "deferred", status: "deferred", labels: [] }),
    row({ id: "closed", status: "closed", labels: ["surface:shared"] }),
    row({ id: "conflict", status: "open", labels: ["surface:ios", "surface:shared"] }),
  ],
  [row({ id: "open" })],
  now,
);

assert.deepEqual(overview.totals, {
  remaining: 5,
  ready: 1,
  open: 2,
  inProgress: 1,
  blocked: 1,
  deferred: 1,
});
assert.deepEqual(overview.surfaceHygiene, {
  ios: 1,
  desktop: 1,
  shared: 1,
  missing: 1,
  conflicting: 1,
});
assert.equal(overview.stale.olderThan24h, 1);
assert.equal(overview.stale.olderThan7d, 0);
assert.deepEqual(Object.keys(overview.stale.oldest[0]).sort(), [
  "id",
  "priority",
  "stale",
  "status",
  "title",
  "updatedAt",
]);

console.log("beads-delivery.test.ts: ok");
```

- [ ] **Step 2: Wire and run the test to verify it fails**

Append `src/lib/beads-delivery.test.ts` to the `app` suite in
`scripts/run-tests.mjs`.

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/lib/beads-delivery.test.ts
```

Expected: FAIL because `src/lib/beads-delivery.ts` does not exist.

- [ ] **Step 3: Implement the pure model**

```ts
// src/lib/beads-delivery.ts
export const PLATFORM_SURFACE_LABELS = [
  "surface:ios",
  "surface:desktop",
  "surface:shared",
] as const;

export type PlatformSurface = "ios" | "desktop" | "shared";
export type PlatformClassification = PlatformSurface | "missing" | "conflicting";
export type BeadStatus = "open" | "in_progress" | "blocked" | "deferred" | "closed";
export type BeadStaleState = "none" | "older_than_24h" | "older_than_7d";

export type BeadDeliveryRow = {
  id: string;
  title: string;
  status: BeadStatus;
  priority: number;
  issue_type?: string | null;
  labels?: string[] | null;
  updated_at?: string | null;
  dependency_count?: number | null;
};

export type BeadDeliveryItem = {
  id: string;
  title: string;
  status: BeadStatus;
  priority: number;
  updatedAt: string | null;
  stale: BeadStaleState;
};

export type BeadsDeliveryOverview = {
  generatedAt: string;
  totals: {
    remaining: number;
    ready: number;
    open: number;
    inProgress: number;
    blocked: number;
    deferred: number;
  };
  stale: {
    olderThan24h: number;
    olderThan7d: number;
    oldest: BeadDeliveryItem[];
  };
  surfaceHygiene: Record<PlatformClassification, number>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_AFTER_MS = DAY_MS;
export const SEVERELY_STALE_AFTER_MS = 7 * DAY_MS;
export const MAX_STALE_ITEMS = 20;

export function classifyPlatform(labels: readonly string[] | null | undefined): PlatformClassification {
  const matches = PLATFORM_SURFACE_LABELS.filter((label) => labels?.includes(label));
  if (matches.length === 0) return "missing";
  if (matches.length > 1) return "conflicting";
  return matches[0].slice("surface:".length) as PlatformSurface;
}

export function classifyStale(row: BeadDeliveryRow, nowMs = Date.now()): BeadStaleState {
  if (row.status !== "in_progress" || !row.updated_at) return "none";
  const updated = Date.parse(row.updated_at);
  if (!Number.isFinite(updated)) return "none";
  const age = nowMs - updated;
  if (age > SEVERELY_STALE_AFTER_MS) return "older_than_7d";
  if (age > STALE_AFTER_MS) return "older_than_24h";
  return "none";
}

export function buildBeadsDeliveryOverview(
  allRows: BeadDeliveryRow[],
  readyRows: BeadDeliveryRow[],
  nowMs = Date.now(),
): BeadsDeliveryOverview {
  const unfinished = allRows.filter((row) => row.status !== "closed");
  const staleRows = unfinished
    .map((row) => ({ row, stale: classifyStale(row, nowMs) }))
    .filter((entry) => entry.stale !== "none")
    .sort((a, b) => Date.parse(a.row.updated_at ?? "") - Date.parse(b.row.updated_at ?? ""));
  const surfaceHygiene: BeadsDeliveryOverview["surfaceHygiene"] = {
    ios: 0,
    desktop: 0,
    shared: 0,
    missing: 0,
    conflicting: 0,
  };
  for (const row of unfinished) surfaceHygiene[classifyPlatform(row.labels)] += 1;
  return {
    generatedAt: new Date(nowMs).toISOString(),
    totals: {
      remaining: unfinished.length,
      ready: readyRows.length,
      open: unfinished.filter((row) => row.status === "open").length,
      inProgress: unfinished.filter((row) => row.status === "in_progress").length,
      blocked: unfinished.filter((row) => row.status === "blocked").length,
      deferred: unfinished.filter((row) => row.status === "deferred").length,
    },
    stale: {
      olderThan24h: staleRows.length,
      olderThan7d: staleRows.filter((entry) => entry.stale === "older_than_7d").length,
      oldest: staleRows.slice(0, MAX_STALE_ITEMS).map(({ row, stale }) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        priority: row.priority,
        updatedAt: row.updated_at ?? null,
        stale,
      })),
    },
    surfaceHygiene,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run the direct Node command from Step 2.

Expected: `beads-delivery.test.ts: ok`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/beads-delivery.ts src/lib/beads-delivery.test.ts scripts/run-tests.mjs
git commit -m "feat(beads): add delivery overview model"
```

---

### Task 2: Enforce platform ownership on canonical Bead creation

**Files:**
- Create: `scripts/beads-create.ts`
- Create: `scripts/beads-create.test.mjs`
- Create: `scripts/beads-surface-audit.ts`
- Create: `scripts/beads-surface-audit.test.mjs`
- Create: `config/beads-surface-grandfather.json`
- Modify: `package.json`
- Modify: `scripts/run-tests.mjs`
- Modify: `src/app/api/beads/route.ts`
- Modify: `src/app/api/beads/route.test.ts`
- Modify: `src/components/familiar-work-queue-view.tsx`
- Modify: `src/components/familiar-work-queue-view.test.ts`
- Modify: `src/lib/asana-tasks.ts`
- Modify: `src/components/asana-task-field.test.ts`
- Modify: `docs/workflows/beads-familiars.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write failing wrapper tests**

Use a temporary fake `bd` executable that records argv and exits with a
configurable status.

```js
// scripts/beads-create.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const temp = mkdtempSync(path.join(os.tmpdir(), "cave-beads-create-"));
const bin = path.join(temp, "bin");
const log = path.join(temp, "argv.json");
mkdirSync(bin);
writeFileSync(path.join(bin, "bd"), `#!/bin/sh\nprintf '%s\\n' "$@" | node -e 'const fs=require("fs");let s="";process.stdin.on("data",d=>s+=d).on("end",()=>fs.writeFileSync(process.env.ARGV_LOG,JSON.stringify(s.trim().split("\\n"))))'\nexit "\${BD_EXIT:-0}"\n`);
chmodSync(path.join(bin, "bd"), 0o755);

const run = (args, exit = "0") => spawnSync(
  process.execPath,
  ["--experimental-strip-types", "scripts/beads-create.ts", ...args],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, ARGV_LOG: log, BD_EXIT: exit },
  },
);

try {
  assert.equal(run(["--surface", "shared", "Example", "--labels", "beads"]).status, 0);
  assert.deepEqual(readFileSync(log, "utf8") && JSON.parse(readFileSync(log, "utf8")), [
    "create",
    "Example",
    "--labels",
    "beads,surface:shared",
  ]);
  assert.equal(run(["Example"]).status, 2);
  assert.equal(run(["--surface", "web", "Example"]).status, 2);
  assert.equal(run(["--surface", "ios", "--surface", "shared", "Example"]).status, 2);
  assert.equal(run(["--surface", "ios", "Example", "--labels", "surface:desktop"]).status, 2);
  assert.equal(run(["--surface", "ios", "Example"], "7").status, 7);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

console.log("beads-create.test.mjs: ok");
```

- [ ] **Step 2: Run the wrapper test to verify it fails**

Run:

```bash
node scripts/beads-create.test.mjs
```

Expected: FAIL because `scripts/beads-create.ts` does not exist.

- [ ] **Step 3: Implement the canonical wrapper**

Implement parsing that removes `--surface <value>`, reads either
`--labels value` or `--labels=value`, rejects any supplied platform label, and
spawns `bd create` with one merged labels argument.

```ts
// scripts/beads-create.ts
import { spawnSync } from "node:child_process";
import { PLATFORM_SURFACE_LABELS, type PlatformSurface } from "../src/lib/beads-delivery.ts";

function fail(message: string): never {
  console.error(`beads-create: ${message}`);
  process.exit(2);
}

function parse(argv: string[]) {
  let surface: PlatformSurface | null = null;
  let labels: string[] = [];
  const forwarded: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--surface") {
      if (surface) fail("--surface must be provided exactly once");
      const value = argv[++i];
      if (!["ios", "desktop", "shared"].includes(value)) fail("--surface must be ios, desktop, or shared");
      surface = value as PlatformSurface;
    } else if (arg.startsWith("--surface=")) {
      if (surface) fail("--surface must be provided exactly once");
      const value = arg.slice("--surface=".length);
      if (!["ios", "desktop", "shared"].includes(value)) fail("--surface must be ios, desktop, or shared");
      surface = value as PlatformSurface;
    } else if (arg === "--labels" || arg === "-l") {
      labels.push(...(argv[++i] ?? "").split(",").map((value) => value.trim()).filter(Boolean));
    } else if (arg.startsWith("--labels=")) {
      labels.push(...arg.slice("--labels=".length).split(",").map((value) => value.trim()).filter(Boolean));
    } else {
      forwarded.push(arg);
    }
  }
  if (!surface) fail("--surface is required");
  if (labels.some((label) => PLATFORM_SURFACE_LABELS.some((platformLabel) => platformLabel === label))) {
    fail("do not pass platform labels through --labels; use --surface");
  }
  labels = [...new Set([...labels, `surface:${surface}`])];
  return { forwarded, labels };
}

const { forwarded, labels } = parse(process.argv.slice(2));
const result = spawnSync("bd", ["create", ...forwarded, "--labels", labels.join(",")], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
```

Add:

```json
"beads:create": "node --experimental-strip-types scripts/beads-create.ts"
```

to `package.json`, and wire the test into the `app` suite.

- [ ] **Step 4: Write the failing grandfathered audit test**

Use a fake `bd` executable that returns one baseline missing-label row, one
new correctly labeled row, and one new conflicting row.

```js
// scripts/beads-surface-audit.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const temp = mkdtempSync(path.join(os.tmpdir(), "cave-surface-audit-"));
const bin = path.join(temp, "bin");
const baseline = path.join(temp, "baseline.json");
mkdirSync(bin);
writeFileSync(baseline, JSON.stringify({ grandfathered: ["cave-old"] }));
writeFileSync(path.join(bin, "bd"), `#!/bin/sh\nprintf '%s' '[{"id":"cave-old","labels":[]},{"id":"cave-good","labels":["surface:shared"]},{"id":"cave-bad","labels":["surface:ios","surface:desktop"]}]'\n`);
chmodSync(path.join(bin, "bd"), 0o755);

try {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/beads-surface-audit.ts", "--baseline", baseline],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cave-bad: conflicting/);
  assert.doesNotMatch(result.stderr, /cave-old/);

  const write = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/beads-surface-audit.ts", "--baseline", baseline, "--write-baseline"],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } },
  );
  assert.equal(write.status, 0);
  assert.deepEqual(JSON.parse(readFileSync(baseline, "utf8")).grandfathered, ["cave-bad", "cave-old"]);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

console.log("beads-surface-audit.test.mjs: ok");
```

- [ ] **Step 5: Implement the audit and generate the grandfather baseline**

The audit runs `bd list --all --json`, classifies each row, ignores baseline
IDs, reports every new missing/conflicting row, and exits 1 on violations.
`--write-baseline` replaces the baseline with all current invalid IDs.

```ts
// scripts/beads-surface-audit.ts
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { classifyPlatform, type BeadDeliveryRow } from "../src/lib/beads-delivery.ts";

const args = process.argv.slice(2);
const baselineIndex = args.indexOf("--baseline");
const baselinePath = path.resolve(
  baselineIndex >= 0 ? args[baselineIndex + 1] : "config/beads-surface-grandfather.json",
);
const writeBaseline = args.includes("--write-baseline");
const command = spawnSync("bd", ["list", "--all", "--json"], { encoding: "utf8", env: process.env });
if (command.status !== 0) process.exit(command.status ?? 1);
const rows = JSON.parse(command.stdout) as BeadDeliveryRow[];
const invalid = rows
  .map((row) => ({ id: row.id, classification: classifyPlatform(row.labels) }))
  .filter((row) => row.classification === "missing" || row.classification === "conflicting")
  .sort((a, b) => a.id.localeCompare(b.id));
if (writeBaseline) {
  writeFileSync(baselinePath, `${JSON.stringify({ grandfathered: invalid.map((row) => row.id) }, null, 2)}\n`);
  process.exit(0);
}
const baseline = new Set(
  (JSON.parse(readFileSync(baselinePath, "utf8")) as { grandfathered: string[] }).grandfathered,
);
const violations = invalid.filter((row) => !baseline.has(row.id));
for (const row of violations) console.error(`${row.id}: ${row.classification}`);
process.exit(violations.length === 0 ? 0 : 1);
```

Add:

```json
"beads:surfaces": "node --experimental-strip-types scripts/beads-surface-audit.ts"
```

Run:

```bash
node scripts/beads-surface-audit.test.mjs
node --experimental-strip-types scripts/beads-surface-audit.ts --write-baseline
pnpm beads:surfaces
```

Expected: the test prints `ok`; the generated baseline contains the current
backlog's invalid IDs; the audit exits 0 immediately afterward.

- [ ] **Step 6: Make Cave Bead creation require `surface`**

Extend `BeadsPostBody`:

```ts
surface?: "ios" | "desktop" | "shared";
```

In the create branch:

```ts
const surface = parsed.body.surface;
if (surface !== "ios" && surface !== "desktop" && surface !== "shared") {
  return NextResponse.json({ ok: false, error: "surface required" }, { status: 400 });
}
const platformLabels = new Set(["surface:ios", "surface:desktop", "surface:shared"]);
const labels = (parsed.body.labels ?? []).map((label) => label.trim()).filter(Boolean);
if (labels.some((label) => platformLabels.has(label))) {
  return NextResponse.json({ ok: false, error: "platform surface must use surface field" }, { status: 400 });
}
createArgs.push("--labels", [...new Set([...labels, `surface:${surface}`])].join(","));
```

Update route tests to assert missing and conflicting surfaces return 400, while
`surface: "shared"` produces `--labels from-pr,surface:shared`.

- [ ] **Step 7: Update every in-app create caller**

Add `surface: "shared"` to the PR filing payload:

```ts
body: JSON.stringify({
  action: "create",
  surface: "shared",
  title: pr.title,
  description: `Filed from unlinked PR #${pr.number} — ${pr.url}`,
  externalRef: `gh-${pr.number}`,
  labels: ["from-pr"],
  projectRoot,
})
```

Add it to the Asana filing payload:

```ts
body: JSON.stringify({
  action: "create",
  surface: "shared",
  title: item.title,
  description: [item.projectName ? `Asana project: ${item.projectName}` : null, `Asana task: ${item.url}`]
    .filter(Boolean)
    .join("\n"),
  externalRef: item.url,
  labels: ["asana"],
  projectRoot: projectRoot ?? undefined,
})
```

Update both source-pin tests to require the field.

- [ ] **Step 8: Update project guidance**

Replace direct creation examples for new work with:

```bash
pnpm beads:create --surface shared "Short title" \
  --description "Why this exists and what needs to be done" \
  --type task --priority 2
```

Document that `surface:shared` covers API/backend/workflow work and that more
specific surface labels may coexist. Document `pnpm beads:surfaces` as the
non-mutating raw-CLI audit and explain that only IDs captured in
`config/beads-surface-grandfather.json` are exempt.

- [ ] **Step 9: Run focused tests**

```bash
node scripts/beads-create.test.mjs
node scripts/beads-surface-audit.test.mjs
pnpm beads:surfaces
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/app/api/beads/route.test.ts
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/components/familiar-work-queue-view.test.ts
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/components/asana-task-field.test.ts
```

Expected: all five tests print `ok`; the surface audit exits 0.

- [ ] **Step 10: Commit**

```bash
git add package.json scripts/beads-create.ts scripts/beads-create.test.mjs \
  scripts/beads-surface-audit.ts scripts/beads-surface-audit.test.mjs \
  config/beads-surface-grandfather.json scripts/run-tests.mjs \
  src/app/api/beads/route.ts src/app/api/beads/route.test.ts \
  src/components/familiar-work-queue-view.tsx src/components/familiar-work-queue-view.test.ts \
  src/lib/asana-tasks.ts src/components/asana-task-field.test.ts \
  docs/workflows/beads-familiars.md AGENTS.md
git commit -m "feat(beads): require platform ownership on creation"
```

---

### Task 3: Add the local desktop overview endpoint

**Files:**
- Create: `src/lib/server/beads-delivery-source.ts`
- Create: `src/app/api/beads/overview/route.ts`
- Create: `src/app/api/beads/overview/route.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing route test**

The fake `bd` executable must return different arrays for `list` and `ready`,
record cwd and `BEADS_DIR`, and support a forced non-zero exit.

Assert:

```ts
const response = await GET(localRequest(
  `http://127.0.0.1/api/beads/overview?projectRoot=${encodeURIComponent(projectA)}`,
));
assert.equal(response.status, 200);
const body = await response.json();
assert.equal(body.ok, true);
assert.equal(body.overview.totals.remaining, 4);
assert.equal(body.overview.totals.ready, 1);
assert.equal(body.overview.surfaceHygiene.missing, 1);
assert.equal("description" in body.overview.stale.oldest[0], false);
assert.equal(
  (await GET(remoteRequest(url))).status,
  403,
  "overview stays local-only",
);
```

- [ ] **Step 2: Run the test to verify it fails**

Wire the test into the `api` suite, then run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/app/api/beads/overview/route.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the server source**

```ts
// src/lib/server/beads-delivery-source.ts
import { buildBeadsDeliveryOverview, type BeadDeliveryRow } from "@/lib/beads-delivery";
import { runBdCommand } from "@/lib/server/beads-cli";
import { resolveSafeBeadsWorkspace } from "@/lib/server/beads-workspace";

const CACHE_MS = 15_000;
const cache = new Map<string, { expiresAt: number; value: ReturnType<typeof buildBeadsDeliveryOverview> }>();

function parseRows(stdout: string): BeadDeliveryRow[] {
  const value: unknown = JSON.parse(stdout);
  if (!Array.isArray(value)) throw new Error("bd returned invalid JSON");
  return value as BeadDeliveryRow[];
}

export async function loadBeadsDeliveryOverview(repoRoot: string, nowMs = Date.now()) {
  const cached = cache.get(repoRoot);
  if (cached && cached.expiresAt > nowMs) return cached.value;
  const workspace = resolveSafeBeadsWorkspace(repoRoot);
  if (!workspace.ok) throw new Error(workspace.error);
  const [all, ready] = await Promise.all([
    runBdCommand(repoRoot, workspace.beadsDir, ["list", "--all", "--json"]),
    runBdCommand(repoRoot, workspace.beadsDir, ["ready", "--json"]),
  ]);
  if (!all.ok) throw new Error(all.error);
  if (!ready.ok) throw new Error(ready.error);
  const value = buildBeadsDeliveryOverview(parseRows(all.stdout), parseRows(ready.stdout), nowMs);
  cache.set(repoRoot, { expiresAt: nowMs + CACHE_MS, value });
  return value;
}
```

Expose a test-only cache reset if route tests need isolation.

- [ ] **Step 4: Implement the local-only route**

```ts
// src/app/api/beads/overview/route.ts
import { NextResponse } from "next/server";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { resolveRepoRoot } from "@/lib/server/issue-worktree-provision";
import { loadBeadsDeliveryOverview } from "@/lib/server/beads-delivery-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const projectRoot = new URL(req.url).searchParams.get("projectRoot");
  if (!projectRoot) {
    return NextResponse.json({ ok: false, error: "projectRoot is required" }, { status: 400 });
  }
  const root = await resolveRepoRoot(projectRoot);
  if (!root.ok) {
    return NextResponse.json({ ok: false, error: root.error }, { status: root.status });
  }
  try {
    return NextResponse.json({
      ok: true,
      projectRoot: root.repoRoot,
      overview: await loadBeadsDeliveryOverview(root.repoRoot),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Beads overview unavailable" }, { status: 502 });
  }
}
```

- [ ] **Step 5: Run the focused tests**

Run the direct route test and `src/lib/beads-delivery.test.ts`.

Expected: both print `ok`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/beads-delivery-source.ts src/app/api/beads/overview/route.ts \
  src/app/api/beads/overview/route.test.ts scripts/run-tests.mjs
git commit -m "feat(beads): expose local delivery overview"
```

---

### Task 4: Render complete accounting in the desktop Work Queue

**Files:**
- Create: `src/components/beads-delivery-overview.tsx`
- Modify: `src/components/familiar-work-queue-view.tsx`
- Modify: `src/components/familiar-work-queue-view.test.ts`
- Modify: `src/styles/familiar-work-queue.css`

- [ ] **Step 1: Add failing source-contract assertions**

Require:

```ts
assert.match(view, /<BeadsDeliveryOverview overview=\{overview\}/);
assert.match(view, /\/api\/beads\/overview\?projectRoot=/);
assert.match(view, /setOverviewError\(/);
assert.match(view, /olderThan7d/);
assert.match(css, /\.fwq-overview-grid \{/);
assert.match(css, /\.fwq-stale-warning \{/);
```

Also assert the existing `fetchQueue` and queue error states remain separate
from overview state.

- [ ] **Step 2: Run the test to verify it fails**

Run `src/components/familiar-work-queue-view.test.ts` with the standard direct
Node command.

Expected: FAIL because the overview component and fetch do not exist.

- [ ] **Step 3: Implement independent overview loading**

Add state:

```ts
const [overview, setOverview] = useState<BeadsDeliveryOverview | null>(null);
const [overviewError, setOverviewError] = useState<string | null>(null);
```

Add:

```ts
async function fetchOverview(projectRoot: string, signal: AbortSignal) {
  const response = await fetch(
    `/api/beads/overview?projectRoot=${encodeURIComponent(projectRoot)}`,
    { cache: "no-store", signal },
  );
  const body = await response.json() as {
    ok?: boolean;
    overview?: BeadsDeliveryOverview;
    error?: string;
  };
  if (!response.ok || !body.ok || !body.overview) {
    throw new Error(body.error || "Beads overview unavailable");
  }
  return body.overview;
}
```

Load queue and overview with `Promise.allSettled`. A queue failure keeps the
existing behavior; an overview failure sets only `overviewError` and preserves
the last good overview. Use the existing announcer hook to announce
`"Beads overview unavailable"` on failure and `"Beads overview refreshed"` on
recovery.

- [ ] **Step 4: Build the overview component**

Render seven metric cells and a stale disclosure:

```tsx
const metrics = [
  ["Remaining", overview.totals.remaining],
  ["Ready", overview.totals.ready],
  ["Open", overview.totals.open],
  ["In progress", overview.totals.inProgress],
  ["Blocked", overview.totals.blocked],
  ["Deferred", overview.totals.deferred],
  ["Unclassified", overview.surfaceHygiene.missing + overview.surfaceHygiene.conflicting],
] as const;
```

Use a real disclosure button with `aria-expanded`, `.focus-ring`, and text for
both stale tiers. The collapsed warning says:

```text
70 in-progress Beads have not changed in 24 hours; 41 are older than 7 days.
```

The expanded rows show Bead ID, title, priority, and relative update age. Add a
second ownership-hygiene disclosure that explicitly says how many Beads are
missing a platform label and how many carry conflicting platform labels. Show
`generatedAt` as the freshness timestamp and include a Retry button when
`overviewError` is set; retry calls only the overview loader.

- [ ] **Step 5: Add token-only styles**

Use `--bg-raised`, `--bg-elevated`, `--border-hairline`,
`--radius-control`, `--radius-card`, `--space-*`, `--text-*`,
`--color-warning`, and `--color-danger`. Do not add literal colors, raw text
pixel sizes, inline styles, or off-grid spacing.

- [ ] **Step 6: Run focused UI and design checks**

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/components/familiar-work-queue-view.test.ts
pnpm codemod:design:check
pnpm lint:design -- src/components/beads-delivery-overview.tsx src/components/familiar-work-queue-view.tsx
```

Expected: source-contract test passes; codemod reports no changes; ESLint exits
0.

- [ ] **Step 7: Commit**

```bash
git add src/components/beads-delivery-overview.tsx \
  src/components/familiar-work-queue-view.tsx \
  src/components/familiar-work-queue-view.test.ts \
  src/styles/familiar-work-queue.css
git commit -m "feat(queue): show complete Beads accounting"
```

---

### Task 5: Persist and validate explicit Board `beadRef`

**Files:**
- Create: `src/lib/card-bead-ref.ts`
- Create: `src/lib/card-bead-ref.test.ts`
- Create: `src/lib/server/card-bead-ref.ts`
- Modify: `src/lib/cave-board-types.ts`
- Modify: `src/lib/cave-board.ts`
- Modify: `src/app/api/board/route.ts`
- Modify: `src/app/api/board/[id]/route.ts`
- Modify: `src/app/api/board/route.test.ts`
- Create: `src/app/api/board/[id]/route.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing normalization tests**

```ts
import assert from "node:assert/strict";
import { normalizeCardBeadRef } from "./card-bead-ref.ts";

assert.deepEqual(
  normalizeCardBeadRef({ id: " cave-tjact ", projectId: " project-a " }),
  { id: "cave-tjact", projectId: "project-a" },
);
assert.equal(normalizeCardBeadRef(null), null);
assert.equal(normalizeCardBeadRef({ id: "../escape", projectId: "project-a" }), null);
assert.equal(normalizeCardBeadRef({ id: "cave-ok", projectId: "" }), null);
assert.equal(normalizeCardBeadRef("cave-ok"), null);
```

Add Board persistence assertions that a valid reference survives load/create/
update and malformed legacy references are dropped without dropping the card.
In the new `[id]` route test, assert remote ordinary edits still succeed while
remote `beadRef` mutations return 403.

- [ ] **Step 2: Run tests to verify they fail**

Run `src/lib/card-bead-ref.test.ts`, `src/app/api/board/route.test.ts`, and
`src/app/api/board/[id]/route.test.ts`.

Expected: FAIL because `beadRef` is not defined.

- [ ] **Step 3: Add the shared type and normalizer**

Add to `src/lib/cave-board-types.ts`:

```ts
export type CardBeadRef = {
  id: string;
  projectId: string;
};
```

In `src/lib/card-bead-ref.ts`, import that type with `import type` and use:

```ts
const BEAD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
```

Return `null` for anything outside those bounds.

- [ ] **Step 4: Persist the field in Board mutators**

Add `beadRef?: CardBeadRef | null` to `Card`, `LegacyCard`, and
`NewCardInput`. In `backfillCard`, `createCard`, and `updateCard`, call
`normalizeCardBeadRef`.

Do not infer a reference from `labels`, `notes`, or `links`.

- [ ] **Step 5: Add live server validation**

```ts
export async function validateCardBeadRef(input: unknown) {
  const ref = normalizeCardBeadRef(input);
  if (!ref) return { ok: false as const, status: 400, error: "invalid_bead_ref" };
  const project = projectById(ref.projectId, await loadProjects());
  if (!project) return { ok: false as const, status: 409, error: "bead_project_not_found" };
  const workspace = resolveSafeBeadsWorkspace(project.root);
  if (!workspace.ok) return { ok: false as const, status: 422, error: workspace.error };
  const shown = await runBdCommand(project.root, workspace.beadsDir, ["show", ref.id, "--json"]);
  if (!shown.ok) return { ok: false as const, status: 404, error: "bead_not_found" };
  return { ok: true as const, ref };
}
```

- [ ] **Step 6: Restrict `beadRef` mutations to local requests**

In Board POST and PATCH:

```ts
if ("beadRef" in body) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  if (body.beadRef !== null) {
    const validated = await validateCardBeadRef(body.beadRef);
    if (!validated.ok) {
      return NextResponse.json({ ok: false, code: validated.error, error: validated.error }, { status: validated.status });
    }
    body.beadRef = validated.ref;
  }
}
```

Ordinary mobile Board edits remain unchanged.

- [ ] **Step 7: Run focused tests**

Run the direct card-ref and both Board route tests.

Expected: valid local references persist; remote reference mutation returns
403; invalid/missing references return stable 4xx responses.

- [ ] **Step 8: Commit**

```bash
git add src/lib/card-bead-ref.ts src/lib/card-bead-ref.test.ts \
  src/lib/server/card-bead-ref.ts src/lib/cave-board-types.ts src/lib/cave-board.ts \
  src/app/api/board/route.ts src/app/api/board/[id]/route.ts \
  src/app/api/board/route.test.ts src/app/api/board/[id]/route.test.ts scripts/run-tests.mjs
git commit -m "feat(board): add explicit Bead references"
```

---

### Task 6: Protect linked cards and add the desktop Delivery field

**Files:**
- Create: `src/components/board-bead-field.tsx`
- Modify: `src/components/board-inspector.tsx`
- Modify: `src/components/board-view.tsx`
- Modify: `src/components/board-clear-done.test.ts`
- Create: `src/components/board-bead-field.test.ts`
- Modify: `src/lib/cave-board.ts`
- Modify: `src/app/api/board/[id]/route.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing retention tests**

Assert:

```ts
assert.equal(await deleteCard(linked.id), "linked_bead");
assert.equal(await deleteCard(unlinked.id), "deleted");
assert.equal(await deleteCard("missing"), "not_found");
```

Add source-contract assertions that:

- `doneCards` excludes `card.beadRef`;
- bulk delete partitions linked and deletable cards;
- the inspector renders `BoardBeadField`;
- the delete action is disabled or hidden while `beadRef` exists.

- [ ] **Step 2: Run tests to verify they fail**

Run the focused Board tests.

Expected: FAIL because delete returns boolean and linked cards are not filtered.

- [ ] **Step 3: Make the server deletion guard authoritative**

```ts
export type DeleteCardResult = "deleted" | "not_found" | "linked_bead";

export async function deleteCard(id: string): Promise<DeleteCardResult> {
  return withBoardLock(async () => {
    const board = await loadBoard();
    const card = board.cards.find((entry) => entry.id === id);
    if (!card) return "not_found";
    if (card.beadRef) return "linked_bead";
    board.cards = board.cards.filter((entry) => entry.id !== id);
    await saveBoard(board);
    return "deleted";
  });
}
```

Map `linked_bead` to:

```ts
NextResponse.json(
  { ok: false, code: "linked_bead_requires_unlink", error: "Unlink the Bead before deleting this task." },
  { status: 409 },
);
```

- [ ] **Step 4: Preserve linked cards in Board cleanup**

Change:

```ts
const doneCards = useMemo(
  () => filtered.filter((card) => card.status === "done" && !card.beadRef),
  [filtered],
);
const preservedDoneCount = useMemo(
  () => filtered.filter((card) => card.status === "done" && card.beadRef).length,
  [filtered],
);
```

Partition bulk deletion and announce:

```ts
const linked = selected.filter((card) => card.beadRef);
const deletable = selected.filter((card) => !card.beadRef);
if (linked.length > 0) {
  announce(`Preserved ${linked.length} task${linked.length === 1 ? "" : "s"} linked to Beads.`);
}
deleteCards(deletable);
```

Show quiet copy beside Clear done when linked done cards are preserved.

- [ ] **Step 5: Build the Board Delivery field**

`BoardBeadField` receives `card`, `projects`, and `onPatch`.

Behavior:

- existing link: show Bead ID and project name, with an Unlink button;
- no link: project select, Bead ID input, and Link button;
- Link calls `onPatch(card.id, { beadRef: { id, projectId } })`;
- server validation errors render inline;
- Unlink calls `onPatch(card.id, { beadRef: null })`;
- successful link/unlink and validation failures use `useAnnouncer()`;
- controls use `.focus-ring`, existing `StandardSelect`, and token-only CSS
  classes already available to Board drawer fields.

Mount it before GitHub and Asana:

```tsx
<BoardBeadField card={card} projects={projects} onPatch={onPatch} />
```

- [ ] **Step 6: Run focused tests and design checks**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/components/board-clear-done.test.ts
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/components/board-bead-field.test.ts
pnpm codemod:design:check
pnpm lint:design -- src/components/board-bead-field.tsx src/components/board-inspector.tsx src/components/board-view.tsx
```

Expected: tests print `ok`; design checks exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/board-bead-field.tsx src/components/board-bead-field.test.ts \
  src/components/board-inspector.tsx src/components/board-view.tsx \
  src/components/board-clear-done.test.ts src/lib/cave-board.ts \
  src/app/api/board/[id]/route.ts scripts/run-tests.mjs
git commit -m "feat(board): protect and manage linked Bead tasks"
```

---

### Task 7: Add the mobile-safe Board delivery endpoint

**Files:**
- Modify: `src/lib/beads-delivery.ts`
- Create: `src/app/api/board/delivery/route.ts`
- Create: `src/app/api/board/delivery/route.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing endpoint test**

Create a Board fixture with:

- two cards linked to different Beads in project A;
- one linked card in project B;
- one unlinked card;
- one malformed persisted reference.

Use fake `bd` output and assert:

```ts
const response = await GET(mobileRequest("http://phone.ts.net/api/board/delivery"));
assert.equal(response.status, 200);
const body = await response.json();
assert.deepEqual(Object.keys(body.cards).sort(), ["card-a", "card-b", "card-c"]);
assert.equal(body.cards["card-a"].state, "available");
assert.equal(body.cards["card-b"].state, "missing");
assert.equal(body.cards["card-c"].state, "unavailable");
assert.equal(JSON.stringify(body).includes(projectA), false);
assert.equal(JSON.stringify(body).includes("stderr"), false);
assert.equal(commandLog.filter((entry) => entry.cwd === projectA).length, 1);
```

Also assert any query parameter returns 400 with
`code: "delivery_parameters_not_allowed"` before loading Board or Beads data.
Add fixtures with 101 linked cards and 11 projects; each must return:

```ts
assert.equal(response.status, 503);
assert.deepEqual(await response.json(), {
  ok: false,
  code: "delivery_scope_exceeded",
  error: "Linked delivery scope exceeds the mobile safety limit.",
});
assert.equal(commandLog.length, 0);
```

- [ ] **Step 2: Run the endpoint test to verify it fails**

Wire it into the `api` suite and run the standard direct Node command.

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Add linked delivery DTO builders**

Add:

```ts
export type BoardDeliveryBead = {
  id: string;
  title: string;
  status: BeadStatus;
  priority: number;
  platform: PlatformSurface | "unclassified";
  ready: boolean;
  updatedAt: string | null;
  stale: BeadStaleState;
};

export function buildBoardDeliveryBead(
  row: BeadDeliveryRow,
  nowMs = Date.now(),
): BoardDeliveryBead {
  const platform = classifyPlatform(row.labels);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    platform: platform === "missing" || platform === "conflicting" ? "unclassified" : platform,
    ready: row.status === "open" && (row.dependency_count ?? 0) === 0,
    updatedAt: row.updated_at ?? null,
    stale: classifyStale(row, nowMs),
  };
}
```

- [ ] **Step 4: Implement bounded grouped loading**

The route accepts no input. Reject `new URL(req.url).searchParams.size > 0`
with the stable code from Step 1. Use constants:

```ts
const MAX_LINKED_CARDS = 100;
const MAX_PROJECTS = 10;
```

Sort valid linked cards by card ID before applying bounds. If either bound is
exceeded, return the stable 503 response from Step 1 before starting any Beads
subprocess.

For each distinct project:

1. resolve through `loadProjects`/`projectById`;
2. resolve the safe Beads workspace;
3. run `bd list --all --json` once;
4. map rows by ID;
5. populate `available`, `missing`, or `unavailable` per card.

Return only:

```ts
return NextResponse.json({ ok: true, generatedAt: new Date().toISOString(), cards });
```

Do not apply `rejectNonLocalRequest`; this is the intentionally mobile-safe
read surface.

- [ ] **Step 5: Run focused endpoint and model tests**

Run `src/app/api/board/delivery/route.test.ts` and
`src/lib/beads-delivery.test.ts`.

Expected: both print `ok`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/beads-delivery.ts src/lib/beads-delivery.test.ts \
  src/app/api/board/delivery/route.ts src/app/api/board/delivery/route.test.ts \
  scripts/run-tests.mjs
git commit -m "feat(board): expose bounded linked delivery state"
```

---

### Task 8: Show linked delivery state in native iOS

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/Models/BoardCard.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift`
- Modify: `apps/ios/CovenCave/CovenCave/State/AppModel.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/TaskDetailView.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/TasksView.swift`
- Create: `apps/ios/CovenCave/CovenCaveTests/BoardDeliveryTests.swift`
- Create: `scripts/ios-board-delivery.test.mjs`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing Swift decoding tests**

```swift
import XCTest
@testable import CovenCave

final class BoardDeliveryTests: XCTestCase {
    func testBoardCardDecodesStructuredBeadRef() throws {
        let data = Data(#"""
        {
          "id":"card-1","title":"Ship","status":"running","priority":"high",
          "beadRef":{"id":"cave-tjact","projectId":"project-a"}
        }
        """#.utf8)
        let card = try JSONDecoder().decode(BoardCard.self, from: data)
        XCTAssertEqual(card.beadRef?.id, "cave-tjact")
        XCTAssertEqual(card.beadRef?.projectId, "project-a")
    }

    func testDeliveryResponseDecodesAvailableMissingAndUnavailable() throws {
        let data = Data(#"""
        {
          "ok":true,
          "generatedAt":"2026-08-09T12:00:00.000Z",
          "cards":{
            "a":{"state":"available","bead":{"id":"cave-a","title":"A","status":"in_progress","priority":1,"platform":"shared","ready":false,"updatedAt":"2026-08-01T00:00:00.000Z","stale":"older_than_7d"}},
            "b":{"state":"missing"},
            "c":{"state":"unavailable"}
          }
        }
        """#.utf8)
        let response = try JSONDecoder().decode(BoardDeliveryResponse.self, from: data)
        XCTAssertEqual(response.cards["a"]?.state, .available)
        XCTAssertEqual(response.cards["a"]?.bead?.stale, .olderThan7d)
        XCTAssertEqual(response.cards["b"]?.state, .missing)
        XCTAssertEqual(response.cards["c"]?.state, .unavailable)
    }
}
```

- [ ] **Step 2: Write the failing iOS source-contract test**

```js
// scripts/ios-board-delivery.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const model = readFileSync("apps/ios/CovenCave/CovenCave/Models/BoardCard.swift", "utf8");
const client = readFileSync("apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift", "utf8");
const app = readFileSync("apps/ios/CovenCave/CovenCave/State/AppModel.swift", "utf8");
const view = readFileSync("apps/ios/CovenCave/CovenCave/Views/TaskDetailView.swift", "utf8");
const tasks = readFileSync("apps/ios/CovenCave/CovenCave/Views/TasksView.swift", "utf8");

assert.match(model, /var beadRef: BoardBeadRef\?/);
assert.match(client, /func boardDelivery\(\) async throws -> \[String: BoardDeliveryState\]/);
assert.match(app, /var taskDelivery: \[String: BoardDeliveryState\] = \[:\]/);
assert.match(app, /taskDelivery = try await client\.boardDelivery\(\)/);
assert.match(app, /guard card\.beadRef == nil else/);
assert.match(view, /Delivery status unavailable/);
assert.match(view, /olderThan7d/);
assert.match(view, /Unlink this Bead on desktop before deleting the task\./);
assert.match(view, /if live\.beadRef == nil/);
assert.match(tasks, /if card\.beadRef == nil/);

console.log("ios-board-delivery.test.mjs: ok");
```

Wire it into the `mobile` suite.

- [ ] **Step 3: Run the Swift and source tests to verify they fail**

Generate the project, then run:

```bash
node scripts/ios-board-delivery.test.mjs
bash scripts/ios-xcodegen.sh
xcodebuild test \
  -project apps/ios/CovenCave/CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -derivedDataPath apps/ios/CovenCave/build/DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  -only-testing:CovenCaveTests/BoardDeliveryTests
```

Expected: compile FAIL because delivery types do not exist.

- [ ] **Step 4: Add Swift DTOs**

In `BoardCard.swift`:

```swift
struct BoardBeadRef: Codable, Hashable {
    let id: String
    let projectId: String
}

enum BoardDeliveryStale: String, Codable {
    case none
    case olderThan24h = "older_than_24h"
    case olderThan7d = "older_than_7d"
}

enum BoardDeliveryAvailability: String, Codable {
    case available, missing, unavailable
}

struct BoardDeliveryBead: Codable, Hashable {
    let id: String
    let title: String
    let status: String
    let priority: Int
    let platform: String
    let ready: Bool
    let updatedAt: String?
    let stale: BoardDeliveryStale
}

struct BoardDeliveryState: Codable, Hashable {
    let state: BoardDeliveryAvailability
    let bead: BoardDeliveryBead?
}

struct BoardDeliveryResponse: Codable {
    let ok: Bool
    let generatedAt: String
    let cards: [String: BoardDeliveryState]
}
```

Add `var beadRef: BoardBeadRef?` and its coding key to `BoardCard`.

- [ ] **Step 5: Add the Cave client call**

```swift
func boardDelivery() async throws -> [String: BoardDeliveryState] {
    let req = try request("api/board/delivery")
    let (data, resp) = try await data(for: req)
    try Self.check(resp)
    return try JSONDecoder().decode(BoardDeliveryResponse.self, from: data).cards
}
```

- [ ] **Step 6: Load delivery state independently**

Add:

```swift
var taskDelivery: [String: BoardDeliveryState] = [:]
```

In `loadTasks`, fetch tasks first, then delivery without discarding tasks when
delivery fails:

```swift
do {
    tasks = try await client.tasks()
    tasksError = nil
} catch {
    tasksError = handleSurfaceError(error)
    tasksLoaded = true
    return
}
do {
    taskDelivery = try await client.boardDelivery()
} catch {
    taskDelivery = [:]
}
tasksLoaded = true
```

Clear `taskDelivery` in host reset/disconnect paths and remove a card's entry
after successful deletion. Start `deleteTask(_:)` with:

```swift
guard card.beadRef == nil else {
    tasksError = "Unlink this Bead on desktop before deleting the task."
    return
}
```

- [ ] **Step 7: Render the read-only Delivery card**

Insert after `propertyGrid`:

```swift
if let ref = live.beadRef {
    deliveryCard(ref: ref, state: app.taskDelivery[live.id])
}
```

The card uses existing `.glass(.raised, cornerRadius: 14)` styling. It renders
text for status, priority, platform, readiness, and age. For unavailable states:

```swift
Text("Delivery status unavailable")
    .font(.caption)
    .foregroundStyle(.secondary)
```

Hide the destructive Delete action when `live.beadRef != nil` and show:

```swift
Text("Unlink this Bead on desktop before deleting the task.")
```

No iOS link/unlink mutation is added.

In `TasksView`, add the destructive swipe action only inside
`if card.beadRef == nil`, so a linked task cannot present a delete affordance
outside its detail screen.

- [ ] **Step 8: Run Swift tests and build**

Run the source-contract test and targeted test command from Step 3, then:

```bash
xcodebuild \
  -project apps/ios/CovenCave/CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Expected: targeted tests pass and the generic iOS build ends with
`** BUILD SUCCEEDED **`.

- [ ] **Step 9: Commit**

```bash
git add apps/ios/CovenCave/CovenCave/Models/BoardCard.swift \
  apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift \
  apps/ios/CovenCave/CovenCave/State/AppModel.swift \
  apps/ios/CovenCave/CovenCave/Views/TaskDetailView.swift \
  apps/ios/CovenCave/CovenCave/Views/TasksView.swift \
  apps/ios/CovenCave/CovenCaveTests/BoardDeliveryTests.swift \
  scripts/ios-board-delivery.test.mjs scripts/run-tests.mjs \
  apps/ios/CovenCave/CovenCave.xcodeproj/project.pbxproj
git commit -m "feat(ios): show linked Bead delivery state"
```

---

### Task 9: Integrate, audit, and verify the vertical slice

**Files:**
- Modify: `docs/superpowers/specs/2026-08-09-beads-delivery-accounting-design.md` only if implementation reality requires a factual correction.
- Modify: `docs/workflows/beads-familiars.md` only if command examples changed during implementation.
- Modify: `scripts/run-tests.mjs` if any new test was not wired in its creating task.

- [ ] **Step 1: Run the focused Node/TypeScript set together**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/beads-delivery.test.ts
node scripts/beads-create.test.mjs
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/app/api/beads/route.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/app/api/beads/overview/route.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/card-bead-ref.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/app/api/board/route.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/app/api/board/[id]/route.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/app/api/board/delivery/route.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/familiar-work-queue-view.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/board-clear-done.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/components/board-bead-field.test.ts
node scripts/ios-board-delivery.test.mjs
node scripts/beads-surface-audit.test.mjs
pnpm beads:surfaces
```

Expected: every command prints its `ok` line.

- [ ] **Step 2: Run repository wiring and static checks**

```bash
pnpm check:tests-wired
pnpm typecheck
pnpm lint
```

Expected: all exit 0.

- [ ] **Step 3: Run the relevant suites**

```bash
pnpm test:api
pnpm test:mobile
```

Expected: both suites complete with all files passed.

- [ ] **Step 4: Run iOS verification**

```bash
bash scripts/ios-xcodegen.sh
xcodebuild test \
  -project apps/ios/CovenCave/CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -derivedDataPath apps/ios/CovenCave/build/DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  -only-testing:CovenCaveTests/BoardDeliveryTests
xcodebuild \
  -project apps/ios/CovenCave/CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Expected: the test target passes and the build succeeds.

- [ ] **Step 5: Exercise the canonical create wrapper without mutation**

```bash
pnpm beads:create --surface shared "Surface audit probe" \
  --type task --priority 3 --dry-run --json
```

Expected: dry-run output contains `surface:shared` exactly once.

- [ ] **Step 6: Inspect the final diff**

```bash
git diff --check
git status --short
git diff --stat origin/main...HEAD
```

Expected: no whitespace errors; only files named in this plan are changed.

- [ ] **Step 7: Record verification on the Bead**

```bash
bd comments add cave-tjact \
  "Verified delivery overview, platform-label creation, explicit Board beadRef retention, bounded mobile delivery endpoint, and native iOS linked-task rendering. Node/API/mobile/type/design checks and targeted iOS test/build passed on feat/cave-tjact-delivery-accounting." \
  --json
```

- [ ] **Step 8: Commit any final wiring corrections**

If Step 2 revealed only test wiring or documentation corrections:

```bash
git add scripts/run-tests.mjs docs/workflows/beads-familiars.md \
  docs/superpowers/specs/2026-08-09-beads-delivery-accounting-design.md
git commit -m "test: verify Beads delivery accounting"
```

If there are no corrections, do not create an empty commit.
