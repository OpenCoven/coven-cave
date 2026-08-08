# Familiar Dashboard Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build phase 1 of Bead `cave-9rwd.1`: the shared, versioned `GET /api/familiars/{id}/dashboard?v=1` DTO, pure builders, reusable server loaders, route, and tests.

**Architecture:** Execute the implementation from a managed worktree based on current `origin/main`. Extract roster enrichment plus sessions and retro loading into reusable server modules, define a bounded section-oriented DTO and pure derivations, then aggregate sources through dependency injection so one failed source cannot erase successful sections. The route validates the Familiar ID, maps known/not-found/unavailable outcomes to stable HTTP responses, emits no raw source errors, and rejects any serialized success payload above 128 KiB.

**Tech Stack:** Next.js App Router, TypeScript, Node.js 24 built-in test/assert APIs, existing Cave stores and derivation helpers, `scripts/run-tests.mjs`.

---

## Phase boundary

This plan implements only the shared server contract and model described in phase 1 of `docs/superpowers/specs/2026-08-07-ios-familiar-command-center-design.md`. It does not add Swift models, the native hub, reminder mutation routes, avatar editing, web UI changes, design-spec edits, goal edits, or Beads mutations.
Existing web Familiar analytics loaders are intentionally not migrated in phase 1; this shared/iOS-first contract is the new read path here, and any web-loader migration is separate follow-up work.

## File map

### Create

- `src/lib/server/familiar-enrichment.ts` — reusable enrichment currently nested in the Familiars route.
- `src/lib/server/familiar-enrichment.test.ts` — enrichment/default/avatar behavior.
- `src/lib/server/sessions-list.ts` — reusable session computation; no cache ownership.
- `src/lib/server/sessions-list.test.ts` — extraction and behavior guards.
- `src/lib/server/retro-runs-snapshot.ts` — reusable daemon/config-backed retro snapshot loader.
- `src/lib/server/retro-runs-snapshot.test.ts` — roster failure, Familiar filtering, and unavailable-state normalization.
- `src/lib/familiar-dashboard.ts` — public DTOs, limits, stable issue codes, byte accounting, and pure Overview/Profile/Analytics builders.
- `src/lib/familiar-dashboard.test.ts` — ordering, bounds, state semantics, analytics definitions, and byte accounting.
- `src/lib/server/familiar-dashboard-data.ts` — production dependencies, independently captured source loads, section assembly, and top-level load outcome.
- `src/lib/server/familiar-dashboard-data.test.ts` — dependency-injected full, partial, empty, unavailable, and redaction cases.
- `src/app/api/familiars/[id]/dashboard/route.ts` — dynamic v1 HTTP route.
- `src/app/api/familiars/[id]/dashboard/route.test.ts` — route statuses, cache headers, schema/version, and payload budget.

### Modify

- `src/app/api/familiars/route.ts:1-132` — call shared enrichment.
- `src/app/api/familiars/route.test.ts:1-95` — pin shared helper delegation instead of nested implementation text.
- `src/app/api/sessions/list/route.ts:1-241` — retain query parsing and SWR cache; delegate computation.
- `src/app/api/sessions/list/route.test.ts:1-55` — assert route/cache delegation and inspect the new helper for compute behavior.
- `src/lib/server/sessions-list-cache.test.ts:55-79` — keep cache ownership assertions route-focused.
- `src/app/api/retro-runs/route.ts:1-70` — delegate to the reusable retro loader.
- `src/app/api/api-contracts.test.ts:620-690` — inspect `sessions-list.ts`, pin the dashboard contract, and prohibit HTTP self-fetches.
- `scripts/run-tests.mjs:1214-1364,1602-1780` — register every new test in the `api` suite and add alias-loader entries for tests whose import graphs use `@/`.

## Contract locked by this plan

```ts
export const FAMILIAR_DASHBOARD_VERSION = 1 as const;

export const FAMILIAR_DASHBOARD_LIMITS = {
  responseBytes: 128 * 1024,
  assignedTasks: 6,
  activeSessions: 3,
  recentSessions: 5,
  attention: 6,
  reminders: 5,
  reports: 30,
  metricSnapshots: 100,
  metricTrailingDays: 30,
  sessionEvidence: 100,
  sessionPulseDays: 14,
} as const;
```

The server emits section states `fresh | partial | empty | unavailable`. The shared DTO additionally defines `stale` for later clients, but no server builder or route may return it.

`scripts/run-tests.mjs` currently owns alias registration through the
`const ALIAS_LOADER = new Set` declaration; `argsForTest()` checks that set and adds
`--import ./scripts/test-alias-register.mjs`. The insertions below use that
existing mechanism. Source-text-only tests are added to `TEST_SUITES.api` but
not to `ALIAS_LOADER`.

---

### Task 1: Extract reusable Familiar enrichment

**Files:**
- Create: `src/lib/server/familiar-enrichment.ts`
- Create: `src/lib/server/familiar-enrichment.test.ts`
- Modify: `src/app/api/familiars/route.ts:1-132`
- Modify: `src/app/api/familiars/route.test.ts:1-95`
- Modify: `src/app/api/familiars/avatar-route.test.ts`
- Modify: `scripts/run-tests.mjs:1214-1216,1631-1633`

- [ ] **Step 1: Write the failing enrichment test**

Create `src/lib/server/familiar-enrichment.test.ts` with injected avatar resolution so it does not touch the real workspace:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { enrichFamiliar } from "./familiar-enrichment.ts";

const config = {
  version: 1,
  defaults: { harness: "claude", model: "claude-sonnet" },
  familiars: {
    sage: {
      display_name: "Sage Local",
      role: "Researcher",
      pronouns: "they/them",
      description: "Finds and verifies evidence.",
      familiarType: "researcher",
      color: "violet",
      harness: "codex",
      model: "gpt-5.3-codex",
      note: "Prefer primary sources.",
      voiceProvider: "elevenlabs",
      voiceModel: "multilingual-v2",
      voiceName: "Sage",
      imageProvider: "openai",
      imageModel: "gpt-image-2",
      imageSize: "1024x1024",
      imageQuality: "high",
      autoSelfReport: true,
      asanaEnabled: false,
      xResearchEnabled: true,
      xPublishEnabled: false,
    },
  },
  roles: [],
  marketplace: { installed: {} },
  multiHost: { mode: "local", hubUrl: "", executorUrls: [] },
  omnigent: {
    enabled: false,
    baseUrl: "",
    defaultAgentId: "",
    defaultHostId: "",
    defaultWorkspace: "",
    hostMap: {},
    hostWorkspaceMap: {},
    exposeHostsInComposer: false,
  },
  remoteHosts: [],
};

test("enrichFamiliar applies config overrides and stable avatar revision", async () => {
  const enriched = await enrichFamiliar(
    {
      id: "sage",
      display_name: "Sage Daemon",
      role: "Generalist",
      status: "online",
      active_sessions: 2,
    },
    config,
    {
      resolveFamiliarAvatar: async () => ({
        absPath: "/workspace/sage/avatars/avatar.png",
        fileName: "avatar.png",
        contentType: "image/png",
        mtimeMs: 1_723_456_789.4,
      }),
    },
  );

  assert.equal(enriched.display_name, "Sage Local");
  assert.equal(enriched.role, "Researcher");
  assert.equal(enriched.defaultHarness, "claude");
  assert.equal(enriched.harness, "codex");
  assert.equal(enriched.harnessOverride, "codex");
  assert.equal(enriched.model, "gpt-5.3-codex");
  assert.equal(enriched.autoSelfReport, true);
  assert.equal(
    enriched.avatarUrl,
    "/api/familiars/sage/avatar?v=1723456789&format=png",
  );
});

test("enrichFamiliar preserves daemon fields and emits null override without an avatar", async () => {
  const enriched = await enrichFamiliar(
    { id: "moss", display_name: "Moss", role: "Builder", pronouns: "she/her" },
    {
      version: 1,
      defaults: { harness: "claude", model: "claude-sonnet" },
      familiars: {},
      roles: [],
      marketplace: { installed: {} },
      multiHost: { mode: "local", hubUrl: "", executorUrls: [] },
      omnigent: {
        enabled: false,
        baseUrl: "",
        defaultAgentId: "",
        defaultHostId: "",
        defaultWorkspace: "",
        hostMap: {},
        hostWorkspaceMap: {},
        exposeHostsInComposer: false,
      },
      remoteHosts: [],
    },
    { resolveFamiliarAvatar: async () => null },
  );

  assert.equal(enriched.display_name, "Moss");
  assert.equal(enriched.pronouns, "she/her");
  assert.equal(enriched.defaultHarness, "claude");
  assert.equal(enriched.harnessOverride, null);
  assert.equal(enriched.autoSelfReport, false);
  assert.equal(enriched.avatarUrl, undefined);
});
```

In `scripts/run-tests.mjs`, make these two exact insertions.

In `TEST_SUITES.api`, replace:

```js
    "src/app/api/familiars/route.test.ts",
    "src/app/api/familiars/[id]/avatar/route.test.ts",
```

with:

```js
    "src/app/api/familiars/route.test.ts",
    "src/lib/server/familiar-enrichment.test.ts",
    "src/app/api/familiars/[id]/avatar/route.test.ts",
```

In `ALIAS_LOADER`, replace:

```js
  "src/app/api/familiars/route.test.ts",
  "src/lib/dev-shell-recovery.test.ts",
```

with:

```js
  "src/app/api/familiars/route.test.ts",
  "src/lib/server/familiar-enrichment.test.ts",
  "src/lib/dev-shell-recovery.test.ts",
```

- [ ] **Step 2: Run the focused test and verify the missing-module failure**

Run:

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/familiar-enrichment.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/lib/server/familiar-enrichment.ts`.

- [ ] **Step 3: Implement the reusable enrichment helper**

Create `src/lib/server/familiar-enrichment.ts`:

```ts
import { bindingFor, type CaveConfig } from "@/lib/cave-config";
import type { Familiar } from "@/lib/types";
import {
  resolveFamiliarAvatar,
  type ResolvedAvatar,
} from "@/lib/server/familiar-avatar";
import type { VisibleFamiliarRosterEntry } from "@/lib/server/familiar-roster";

export type FamiliarEnrichmentDependencies = {
  resolveFamiliarAvatar: (id: string) => Promise<ResolvedAvatar | null>;
};

const DEFAULT_DEPENDENCIES: FamiliarEnrichmentDependencies = {
  resolveFamiliarAvatar,
};

export async function enrichFamiliar(
  familiar: VisibleFamiliarRosterEntry,
  config: CaveConfig,
  dependencies: FamiliarEnrichmentDependencies = DEFAULT_DEPENDENCIES,
): Promise<Familiar> {
  const configEntry = config.familiars[familiar.id] ?? {};
  const binding = bindingFor(config, familiar.id);
  const avatar = await dependencies.resolveFamiliarAvatar(familiar.id);

  return {
    ...familiar,
    display_name: binding.display_name ?? familiar.display_name,
    role: binding.role ?? familiar.role,
    familiarType: binding.familiarType,
    pronouns: binding.pronouns ?? familiar.pronouns,
    description: binding.description ?? familiar.description,
    color: binding.color,
    harness: binding.harness,
    defaultHarness: config.defaults.harness,
    harnessOverride: configEntry.harness ?? null,
    model: binding.model,
    note: binding.note,
    voiceProvider: binding.voiceProvider,
    voiceModel: binding.voiceModel,
    voiceName: binding.voiceName,
    imageProvider: binding.imageProvider,
    imageModel: binding.imageModel,
    imageSize: binding.imageSize,
    imageQuality: binding.imageQuality,
    autoSelfReport: configEntry.autoSelfReport ?? false,
    asanaEnabled: configEntry.asanaEnabled,
    asanaWorkspaceGid: configEntry.asanaWorkspaceGid,
    xResearchEnabled: configEntry.xResearchEnabled === true,
    xPublishEnabled: configEntry.xPublishEnabled === true,
    ...(binding.omnigent ? { omnigent: binding.omnigent } : {}),
    avatarUrl: avatar
      ? `/api/familiars/${encodeURIComponent(familiar.id)}/avatar?v=${Math.round(avatar.mtimeMs)}&format=png`
      : undefined,
  };
}
```

- [ ] **Step 4: Make the Familiars route delegate to the helper**

In `src/app/api/familiars/route.ts`, replace:

```ts
import { bindingFor, saveConfig } from "@/lib/cave-config";
```

with:

```ts
import { saveConfig } from "@/lib/cave-config";
```

Replace:

```ts
import { resolveFamiliarAvatar } from "@/lib/server/familiar-avatar";
```

with:

```ts
import { enrichFamiliar } from "@/lib/server/familiar-enrichment";
```

Delete the exact contiguous block beginning with:

```ts
  const enrichFamiliar = async (f: (typeof rosterResult.roster)[number]) => {
```

and ending with:

```ts
  };
```

immediately before
`const familiars = await Promise.all(roster.map(enrichFamiliar));`. Replace
that declaration with:

```ts
const familiars = await Promise.all(
  roster.map((familiar) => enrichFamiliar(familiar, config)),
);
```

In `src/app/api/familiars/route.test.ts`, insert this read immediately after the existing `source` read:

```ts
const enrichmentSource = readFileSync(
  new URL("../../../lib/server/familiar-enrichment.ts", import.meta.url),
  "utf8",
);
```

For each existing assertion whose regular expression contains `configEntry`,
`defaultHarness`, `harnessOverride`, or `autoSelfReport`, change only its first
argument from `source` to `enrichmentSource`. Then append this exact delegation
assertion:

```ts
assert.match(
  source,
  /roster\.map\(\(familiar\) => enrichFamiliar\(familiar, config\)\)/,
  "Familiars API delegates enrichment to the shared server helper",
);
```

- [ ] **Step 5: Run the focused tests and verify they pass**

Run:

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/familiar-enrichment.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/app/api/familiars/route.test.ts
```

Expected: both commands print their success output and exit 0.

- [ ] **Step 6: Commit the extraction**

```bash
git add src/lib/server/familiar-enrichment.ts src/lib/server/familiar-enrichment.test.ts src/app/api/familiars/route.ts src/app/api/familiars/route.test.ts scripts/run-tests.mjs
git commit -m "refactor: share familiar enrichment"
```

---

### Task 2: Extract reusable sessions and retro loaders

**Files:**
- Create: `src/lib/server/sessions-list.ts`
- Create: `src/lib/server/sessions-list.test.ts`
- Create: `src/lib/server/retro-runs-snapshot.ts`
- Create: `src/lib/server/retro-runs-snapshot.test.ts`
- Modify: `src/app/api/sessions/list/route.ts:1-241`
- Modify: `src/app/api/sessions/list/route.test.ts:1-55`
- Modify: `src/lib/server/sessions-list-cache.ts`
- Modify: `src/lib/server/sessions-list-cache.test.ts:55-79`
- Modify: `src/app/api/retro-runs/route.ts:1-70`
- Modify: `src/app/api/retro-runs/route.test.ts`
- Modify: `src/app/api/api-contracts.test.ts:620-690`
- Modify: `scripts/run-tests.mjs:1278-1281,1631-1634`

- [ ] **Step 1: Write failing source-boundary tests**

Create `src/lib/server/sessions-list.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const helper = readFileSync(new URL("./sessions-list.ts", import.meta.url), "utf8");
const route = readFileSync(
  new URL("../../app/api/sessions/list/route.ts", import.meta.url),
  "utf8",
);

assert.match(
  helper,
  /export async function computeSessionsList\(/,
  "the reusable server helper exports session computation",
);
assert.match(
  helper,
  /if \(!collapseFamiliarWorkspace\) return sessions;/,
  "the reusable helper preserves the collapse fast path",
);
assert.equal(
  (helper.match(/applyFamiliarWorkspaceCollapse\(/g) || []).length,
  3,
  "the helper applies collapse in both healthy and degraded branches",
);
assert.match(
  helper,
  /hasActiveChatRun\(conv\.sessionId\)/,
  "pending local conversations retain live-run truth",
);
assert.doesNotMatch(
  helper,
  /sessionsListCache/,
  "the reusable compute helper does not own the route cache",
);
assert.match(
  route,
  /sessionsListCache\.get\(cacheKey, \(\) =>\s*computeSessionsList\(/,
  "the route retains cache ownership and delegates computation",
);

console.log("sessions-list.test.ts: ok");
```

Create `src/lib/server/retro-runs-snapshot.test.ts` with dependency injection:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadRetroRunsSnapshot } from "./retro-runs-snapshot.ts";

const RETRO_CONFIG = {
  version: 1,
  defaults: { harness: "claude", model: "claude-sonnet" },
  familiars: {},
  roles: [],
  marketplace: { installed: {} },
  multiHost: { mode: "local", hubUrl: "", executorUrls: [] },
  omnigent: {
    enabled: false,
    baseUrl: "",
    defaultAgentId: "",
    defaultHostId: "",
    defaultWorkspace: "",
    hostMap: {},
    hostWorkspaceMap: {},
    exposeHostsInComposer: false,
  },
  remoteHosts: [],
};

test("retro loader reports a stable failure without exposing the daemon error", async () => {
  const result = await loadRetroRunsSnapshot({
    familiarId: "sage",
    dependencies: {
      loadConfig: async () => RETRO_CONFIG,
      callDaemon: async () => ({ ok: false, status: 503, error: "token=/secret/path" }),
    },
  });

  assert.deepEqual(result, {
    ok: false,
    code: "retro_roster_unavailable",
    error: result.error,
    snapshot: {
      generatedAt: result.snapshot.generatedAt,
      summary: {
        totalRuns: 0,
        accepted: 0,
        reverted: 0,
        runningFamiliars: 0,
        familiarsWithData: 0,
        trackCounts: { synthesis: 0, prompt: 0, memory: 0 },
        lastRun: null,
      },
      familiars: [],
      runs: [],
    },
  });
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("/secret/path"), false);
});

test("retro loader fetches only the requested familiar state", async () => {
  const paths: string[] = [];
  const result = await loadRetroRunsSnapshot({
    familiarId: "sage",
    dependencies: {
      loadConfig: async () => RETRO_CONFIG,
      callDaemon: async ({ path }) => {
        paths.push(path);
        if (path === "/api/v1/familiars") {
          return {
            ok: true,
            status: 200,
            data: [
              { id: "sage", display_name: "Sage", role: "Researcher" },
              { id: "moss", display_name: "Moss", role: "Builder" },
            ],
          };
        }
        return {
          ok: true,
          status: 200,
          data: { ok: true, state: { familiar_id: "sage", iterations: [] } },
        };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(paths, ["/api/v1/familiars", "/api/v1/skills/eval-loop/sage"]);
  assert.equal(result.snapshot.familiars.length, 1);
  assert.equal(result.snapshot.familiars[0].familiarId, "sage");
});
```

In `scripts/run-tests.mjs`, make these exact insertions.

In `TEST_SUITES.api`, replace:

```js
    "src/app/api/sessions/list/route.test.ts",
    "src/app/api/chat/send/harness-routing-host-session.test.ts",
```

with:

```js
    "src/app/api/sessions/list/route.test.ts",
    "src/lib/server/sessions-list.test.ts",
    "src/lib/server/retro-runs-snapshot.test.ts",
    "src/app/api/chat/send/harness-routing-host-session.test.ts",
```

Only `retro-runs-snapshot.test.ts` imports a module whose graph resolves
`@/`; `sessions-list.test.ts` reads source text and does not need the loader.
In `ALIAS_LOADER`, replace:

```js
  "src/app/api/familiars/route.test.ts",
  "src/lib/server/familiar-enrichment.test.ts",
  "src/lib/dev-shell-recovery.test.ts",
```

with:

```js
  "src/app/api/familiars/route.test.ts",
  "src/lib/server/familiar-enrichment.test.ts",
  "src/lib/server/retro-runs-snapshot.test.ts",
  "src/lib/dev-shell-recovery.test.ts",
```

- [ ] **Step 2: Run the tests and verify both fail**

Run:

```bash
node --experimental-strip-types src/lib/server/sessions-list.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/retro-runs-snapshot.test.ts
```

Expected: the first fails because `sessions-list.ts` does not exist; the second fails because `retro-runs-snapshot.ts` does not exist.

- [ ] **Step 3: Move session computation into the shared helper**

Create `src/lib/server/sessions-list.ts` with this exact import block:

```ts
import fs from "node:fs";
import { callDaemon } from "@/lib/coven-daemon";
import { loadState, type CaveState } from "@/lib/cave-config";
import { listConversations } from "@/lib/cave-conversations";
import { hasActiveChatRun } from "@/lib/server/chat-stop-registry";
import {
  sweepAutoArchive,
  sweepMergedPrAutoArchive,
} from "@/lib/chat-auto-archive-sweep";
import {
  localConversationSessionRows,
  mergeSessionRows,
} from "@/lib/session-list-merge";
import {
  applyStaleRunningPresentation,
  sweepStaleRunningGhosts,
} from "@/lib/server/stale-running-sweep";
import { enrichSessionsWithGitContext } from "@/lib/session-git-enrich";
import { collapseFamiliarWorkspaceSessions } from "@/lib/familiar-workspace-sessions";
import { familiarWorkspacesRoot, readFamiliarWorkspaces } from "@/lib/coven-paths";
import type { SessionsListResult } from "@/lib/server/sessions-list-cache";
import { loadProjects, projectForRoot } from "@/lib/cave-projects";
import { filterProjectsForFamiliar } from "@/lib/project-permissions";
import { scopeSessionsToFamiliarProjects } from "@/lib/session-project-scope";
import type { SessionInitiator, SessionRow } from "@/lib/types";
```

From `src/app/api/sessions/list/route.ts`, copy the single contiguous source
block that starts at `type DaemonSession = {` and ends at the closing brace of
`computeSessionsList`, immediately before `export async function GET`. Paste it
after the import block. Make only one change in the pasted block: add `export`
to `computeSessionsList`. The copied declarations have these complete
signatures and the `DaemonSession` type must remain exactly:

```ts
type DaemonSession = {
  id: string;
  project_root: string;
  harness: string;
  title: string;
  status: string;
  exit_code: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  initiator?: SessionInitiator;
};
function isTrueProjectCwd(projectRoot: string): boolean;
function applySweptRows(
  sessions: SessionRow[],
  swept: Map<string, string>,
  includeArchived: boolean,
): SessionRow[];
async function applyMergedPrAutoArchive(
  sessions: SessionRow[],
  state: CaveState,
  includeArchived: boolean,
): Promise<SessionRow[]>;
async function scopeForFamiliar(
  sessions: SessionRow[],
  projects: Awaited<ReturnType<typeof loadProjects>>,
  familiarId: string | null,
): Promise<SessionRow[]>;
async function applyAutoArchiveSweep(
  sessions: SessionRow[],
  state: CaveState,
  includeArchived: boolean,
): Promise<SessionRow[]>;
async function applyFamiliarWorkspaceCollapse(
  sessions: SessionRow[],
  collapseFamiliarWorkspace: boolean,
): Promise<SessionRow[]>;
export async function computeSessionsList(
  includeArchived: boolean,
  familiarId: string | null,
  collapseFamiliarWorkspace: boolean,
): Promise<SessionsListResult>;
```

Delete that copied contiguous block from the route. Do not put `NextResponse`,
`sessionsListCache`, or `isValidFamiliarId` in the helper.

Reduce `src/app/api/sessions/list/route.ts` to route concerns:

```ts
import { NextResponse } from "next/server";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { computeSessionsList } from "@/lib/server/sessions-list";
import { sessionsListCache } from "@/lib/server/sessions-list-cache";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  const familiarId = url.searchParams.get("familiarId")?.trim() || null;
  const collapseFamiliarWorkspace =
    url.searchParams.get("collapseFamiliarWorkspace") === "1";
  if (familiarId && !isValidFamiliarId(familiarId)) {
    return NextResponse.json(
      { ok: false, error: "invalid familiar id", sessions: [] },
      { status: 400 },
    );
  }
  const cacheKey = `${includeArchived ? "archived" : "active"}:${familiarId ?? "all"}:${
    collapseFamiliarWorkspace ? "collapse" : "full"
  }`;
  const result = await sessionsListCache.get(cacheKey, () =>
    computeSessionsList(includeArchived, familiarId, collapseFamiliarWorkspace),
  );
  return NextResponse.json(result.payload, result.init);
}
```

- [ ] **Step 4: Update existing session source-contract tests**

In `src/app/api/sessions/list/route.test.ts`, replace:

```ts
const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
```

with:

```ts
const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const helper = readFileSync(
  new URL("../../../../lib/server/sessions-list.ts", import.meta.url),
  "utf8",
);
```

Change the first argument from `source` to `route` for the three assertions
whose messages mention query parsing, cache-key collapse mode, and threading
the collapse flag into `computeSessionsList`. Change the first argument from
`source` to `helper` for the no-op collapse assertion, pending-conversation
assertion, and live-run-registry import assertion. Change
`source.match(/applyFamiliarWorkspaceCollapse\(/g)` to
`helper.match(/applyFamiliarWorkspaceCollapse\(/g)`.

In `src/lib/server/sessions-list-cache.test.ts`, replace the complete block
that starts with:

```ts
// The list route consumes the SHARED cache; a locally re-created cache would
```

and ends at the closing brace immediately before:

```ts
// Every user-facing session mutator busts the cache after its state write
```

with:

```ts
// The list route consumes the shared cache and delegates the cached compute.
{
const route = read("../../app/api/sessions/list/route.ts");
assert.match(route, /sessionsListCache/, "the list route imports the shared cache");
assert.doesNotMatch(route, /createSwrCache/, "the route does not create a private cache");
assert.match(route, /computeSessionsList/, "the cached callback delegates to the shared compute helper");
}
```

In `src/app/api/api-contracts.test.ts`, replace the existing declaration:

```ts
const sessionsListSource = readFileSync(
  path.join(apiRoot, "sessions", "list", "route.ts"),
  "utf8",
);
```

with:

```ts
const sessionsListSource = readFileSync(
  path.join(apiRoot, "..", "..", "lib", "server", "sessions-list.ts"),
  "utf8",
);
const sessionsListRouteSource = readFileSync(
  path.join(apiRoot, "sessions", "list", "route.ts"),
  "utf8",
);
```

Change only the first argument of assertions that mention
`sessionsListCache`, `createSwrCache`, or the route cache callback from
`sessionsListSource` to `sessionsListRouteSource`. Leave project validation,
`enrichSessionsWithGitContext`, and synchronous-subprocess assertions pointed
at `sessionsListSource`.

- [ ] **Step 5: Implement the reusable retro loader**

Create `src/lib/server/retro-runs-snapshot.ts`:

```ts
import { bindingFor, loadConfig, type CaveConfig } from "@/lib/cave-config";
import { callDaemon, type DaemonResponse } from "@/lib/coven-daemon";
import { unwrapDaemonEvalState } from "@/lib/eval-loop-daemon";
import {
  buildRetroRunsSnapshot,
  normalizeRetroRunState,
  type RetroRunsSnapshot,
} from "@/lib/retro-runs";
import { redactSecretsDeep, redactSecretText } from "@/lib/secret-redaction";

type DaemonFamiliar = {
  id: string;
  display_name?: string;
  role?: string;
};

export type RetroRunsSnapshotIssueCode =
  | "retro_roster_unavailable"
  | "retro_state_unavailable";

export type RetroRunsSnapshotResult =
  | { ok: true; snapshot: RetroRunsSnapshot }
  | {
      ok: false;
      code: RetroRunsSnapshotIssueCode;
      error: string;
      snapshot: RetroRunsSnapshot;
    };

export type RetroRunsSnapshotDependencies = {
  loadConfig: () => Promise<CaveConfig>;
  callDaemon: <T>(request: { path: string }) => Promise<DaemonResponse<T>>;
};

const DEFAULT_DEPENDENCIES: RetroRunsSnapshotDependencies = {
  loadConfig,
  callDaemon,
};

export async function loadRetroRunsSnapshot({
  familiarId = null,
  dependencies = DEFAULT_DEPENDENCIES,
}: {
  familiarId?: string | null;
  dependencies?: RetroRunsSnapshotDependencies;
} = {}): Promise<RetroRunsSnapshotResult> {
  const [familiarsRes, config] = await Promise.all([
    dependencies.callDaemon<DaemonFamiliar[]>({ path: "/api/v1/familiars" }),
    dependencies.loadConfig(),
  ]);

  if (!familiarsRes.ok || !familiarsRes.data) {
    return {
      ok: false,
      code: "retro_roster_unavailable",
      error: redactSecretText(
        familiarsRes.error ?? `daemon http ${familiarsRes.status}`,
      ),
      snapshot: buildRetroRunsSnapshot([]),
    };
  }

  let stateFailed = false;
  const states = await Promise.all(
    familiarsRes.data
      .filter((familiar) => !familiarId || familiar.id === familiarId)
      .map(async (familiar) => {
        const safe = redactSecretsDeep(familiar);
        const binding = bindingFor(config, familiar.id);
        const input = {
          id: familiar.id,
          displayName: binding.display_name ?? safe.display_name ?? familiar.id,
          role: binding.role ?? safe.role,
        };
        const stateRes = await dependencies.callDaemon<unknown>({
          path: `/api/v1/skills/eval-loop/${encodeURIComponent(familiar.id)}`,
        });
        if (!stateRes.ok || !stateRes.data) {
          stateFailed = true;
          return normalizeRetroRunState({
            familiar: input,
            state: {
              familiar_id: familiar.id,
              last_run: null,
              iterations: [],
              track_counts: { synthesis: 0, prompt: 0, memory: 0 },
              total_accepted: 0,
              total_reverted: 0,
              running: false,
              unavailable: "retro_state_unavailable",
            },
          });
        }
        return normalizeRetroRunState({
          familiar: input,
          state: redactSecretsDeep(unwrapDaemonEvalState(stateRes.data)),
        });
      }),
  );

  const snapshot = buildRetroRunsSnapshot(states);
  return stateFailed
    ? {
        ok: false,
        code: "retro_state_unavailable",
        error: "One or more retro states are unavailable.",
        snapshot,
      }
    : { ok: true, snapshot };
}
```

The helper preserves the existing retro route's sanitized `error` field while adding a stable `code` for dashboard issue mapping.

- [ ] **Step 6: Make the retro route delegate without changing its public shape**

Replace `src/app/api/retro-runs/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { loadRetroRunsSnapshot } from "@/lib/server/retro-runs-snapshot";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const familiarId = new URL(req.url).searchParams.get("familiarId")?.trim() || null;
  const result = await loadRetroRunsSnapshot({ familiarId });
  return NextResponse.json(
    result.ok
      ? { ok: true, snapshot: result.snapshot }
      : { ok: false, error: result.error, snapshot: result.snapshot },
  );
}
```

- [ ] **Step 7: Run all extraction tests**

Run:

```bash
node --experimental-strip-types src/lib/server/sessions-list.test.ts
node --experimental-strip-types src/app/api/sessions/list/route.test.ts
node --experimental-strip-types src/lib/server/sessions-list-cache.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/retro-runs-snapshot.test.ts
node --experimental-strip-types src/app/api/api-contracts.test.ts
```

Expected: all commands exit 0; the source-contract tests confirm cache ownership stayed in the route and computation moved to the helper.

- [ ] **Step 8: Commit the loader extractions**

```bash
git add src/lib/server/sessions-list.ts src/lib/server/sessions-list.test.ts src/lib/server/retro-runs-snapshot.ts src/lib/server/retro-runs-snapshot.test.ts src/app/api/sessions/list/route.ts src/app/api/sessions/list/route.test.ts src/lib/server/sessions-list-cache.test.ts src/app/api/retro-runs/route.ts src/app/api/api-contracts.test.ts scripts/run-tests.mjs
git commit -m "refactor: share dashboard source loaders"
```

---

### Task 3: Define dashboard DTOs, limits, states, and pure builders

**Files:**
- Create: `src/lib/familiar-dashboard.ts`
- Create: `src/lib/familiar-dashboard.test.ts`
- Modify: `src/lib/session-pulse.ts`
- Modify: `src/lib/session-pulse.test.ts`
- Modify: `scripts/run-tests.mjs:1363-1364,1766-1768`

- [ ] **Step 1: Write failing DTO and builder tests**

Create `src/lib/familiar-dashboard.test.ts`. Use fixed timestamps and fixture rows. The test must include these assertions:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FAMILIAR_DASHBOARD_LIMITS,
  FAMILIAR_DASHBOARD_VERSION,
  buildFamiliarAnalyticsDigest,
  buildFamiliarOverview,
  buildFamiliarProfile,
  buildDashboardSection,
  serializedDashboardBytes,
} from "./familiar-dashboard.ts";

const NOW = Date.parse("2026-08-07T20:00:00.000Z");

test("published limits match the v1 contract", () => {
  assert.equal(FAMILIAR_DASHBOARD_VERSION, 1);
  assert.deepEqual(FAMILIAR_DASHBOARD_LIMITS, {
    responseBytes: 131072,
    assignedTasks: 6,
    activeSessions: 3,
    recentSessions: 5,
    attention: 6,
    reminders: 5,
    reports: 30,
    metricSnapshots: 100,
    metricTrailingDays: 30,
    sessionEvidence: 100,
    sessionPulseDays: 14,
  });
});

test("Overview prefers a running non-generated session for Now", () => {
  const overview = buildFamiliarOverview({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    tasks: [],
    sessions: [
      modelSession(1, {
        id: "generated",
        status: "running",
        generated: true,
        title: "Automation",
        updated_at: "2026-08-07T19:59:00.000Z",
      }),
      modelSession(2, {
        id: "chat-1",
        status: "running",
        title: "Investigate regression",
        updated_at: "2026-08-07T19:58:00.000Z",
      }),
    ],
    reminders: [],
    healRequests: [],
    now: NOW,
  });

  assert.deepEqual(overview.now, {
    kind: "session",
    id: "chat-1",
    title: "Investigate regression",
    updatedAt: "2026-08-07T19:58:00.000Z",
  });
  assert.equal(overview.sessions.totalNonGenerated, 1);
});

test("blocked task rows preserve dependencies, primary blocker, and next step", () => {
  const dependency = {
    id: "dep-1",
    kind: "human",
    label: "Approve production access",
    state: "unresolved",
    origin: "human",
    createdAt: "2026-08-07T18:00:00.000Z",
  };
  const nextStep = {
    summary: "Request production access approval",
    requiresApproval: true,
    origin: "human",
    updatedAt: "2026-08-07T18:01:00.000Z",
  };
  const overview = buildFamiliarOverview({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    tasks: [modelTask(1, {
      id: "task-1",
      title: "Deploy service",
      status: "blocked",
      priority: "urgent",
      dependencies: [dependency],
      primaryBlockerId: "dep-1",
      nextStep,
      updatedAt: "2026-08-07T18:02:00.000Z",
    })],
    sessions: [],
    reminders: [],
    healRequests: [],
    now: NOW,
  });

  assert.deepEqual(overview.tasks.items[0].dependencies, [dependency]);
  assert.deepEqual(overview.tasks.items[0].primaryBlocker, dependency);
  assert.deepEqual(overview.tasks.items[0].nextStep, nextStep);
});

test("Overview bounds lists while retaining totals and scopes reminders", () => {
  const tasks = Array.from({ length: 8 }, (_, index) => modelTask(index, {
    title: `Task ${index}`,
    status: "inbox",
    priority: "medium",
    updatedAt: `2026-08-07T1${index}:00:00.000Z`,
  }));
  const reminders = Array.from({ length: 8 }, (_, index) => modelReminder(index, {
    familiarId: index === 7 ? "moss" : "sage",
    title: `Reminder ${index}`,
    status: index < 2 ? "fired" : "pending",
    updatedAt: `2026-08-07T1${index}:00:00.000Z`,
  }));
  const overview = buildFamiliarOverview({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    tasks,
    sessions: [],
    reminders,
    healRequests: [],
    now: NOW,
  });

  assert.equal(overview.tasks.total, 8);
  assert.equal(overview.tasks.items.length, 6);
  assert.equal(overview.reminders.total, 7);
  assert.equal(overview.reminders.items.length, 5);
  assert.equal(overview.reminders.items.some((item) => item.familiarId === "moss"), false);
  assert.ok(overview.attention.items.every((item) => item.source !== ""));
});

test("section state is deterministic and server builders never emit stale", () => {
  const generatedAt = "2026-08-07T20:00:00.000Z";
  const success = { ok: true, data: [] };
  const failure = { ok: false, source: "sessions", code: "sessions_unavailable" };

  assert.equal(buildDashboardSection({
    generatedAt,
    required: [success],
    optional: [],
    data: { rows: [1] },
    empty: false,
  }).state, "fresh");
  assert.equal(buildDashboardSection({
    generatedAt,
    required: [success],
    optional: [],
    data: { rows: [] },
    empty: true,
  }).state, "empty");
  assert.equal(buildDashboardSection({
    generatedAt,
    required: [success, failure],
    optional: [],
    data: { rows: [1] },
    empty: false,
  }).state, "partial");
  assert.equal(buildDashboardSection({
    generatedAt,
    required: [failure],
    optional: [],
    data: null,
    empty: false,
  }).state, "unavailable");
});

test("Analytics publishes bands and samples without a composite score", () => {
  const analytics = buildFamiliarAnalyticsDigest({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    sessions: [],
    reports: [],
    reportTotal: 0,
    snapshots: [],
    snapshotTotal: 0,
    memories: [],
    memoryAvailability: "ready",
    retroState: null,
    contractReport: null,
    feedback: { up: 0, down: 0, total: 0, models: [], runtimes: [] },
    now: NOW,
  });

  assert.equal(analytics.activity.pulse.length, 14);
  assert.equal(analytics.confidence.band, null);
  assert.equal(analytics.confidence.sampleCount, 0);
  assert.equal(analytics.confidence.insufficientData, true);
  assert.equal("score" in analytics.confidence, false);
  assert.equal("overallScore" in analytics, false);
  assert.equal(analytics.memory.count, 0);
  assert.equal(analytics.memory.availability, "ready");
});

test("serializedDashboardBytes counts UTF-8 bytes", () => {
  assert.equal(serializedDashboardBytes({ value: "🧙" }), Buffer.byteLength('{"value":"🧙"}'));
});
```

Append these exact helpers and tests to
`src/lib/familiar-dashboard.test.ts`:

```ts
function modelTask(
  index: number,
  overrides: Record<string, unknown> = {},
) {
  const updatedAt = new Date(NOW - index * 60_000).toISOString();
  return {
    id: `task-${index}`,
    title: `Task ${index}`,
    notes: "",
    status: "inbox",
    priority: "medium",
    familiarId: "sage",
    sessionId: null,
    cwd: null,
    links: [],
    github: [],
    asana: [],
    labels: [],
    createdAt: updatedAt,
    updatedAt,
    lifecycle: "queued",
    lifecycleAt: updatedAt,
    retryCount: 0,
    maxRetries: 2,
    steps: [],
    dependencies: [],
    primaryBlockerId: null,
    nextStep: null,
    ...overrides,
  };
}

function modelReminder(
  index: number,
  overrides: Record<string, unknown> = {},
) {
  const updatedAt = new Date(NOW - index * 60_000).toISOString();
  return {
    id: `reminder-${index}`,
    kind: "reminder",
    title: `Reminder ${index}`,
    body: null,
    status: "pending",
    createdAt: updatedAt,
    updatedAt,
    fireAt: null,
    recurrence: { type: "none" },
    source: "user",
    familiarId: "sage",
    ...overrides,
  };
}

function modelSession(
  index: number,
  overrides: Record<string, unknown> = {},
) {
  const minute = String(index % 60).padStart(2, "0");
  return {
    id: `session-${index}`,
    project_root: "/repo",
    harness: "claude",
    model: "claude-sonnet",
    runtime: "local",
    title: `Session ${index}`,
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: `2026-08-07T18:${minute}:00.000Z`,
    updated_at: `2026-08-07T19:${minute}:00.000Z`,
    familiarId: "sage",
    origin: "chat",
    generated: false,
    ...overrides,
  };
}

function modelReport(
  index: number,
  overrides: Record<string, unknown> = {},
) {
  const reportedAt = new Date(NOW - index * 60_000).toISOString();
  return {
    id: `report-${index}`,
    familiarId: "sage",
    sessionId: `session-${index}`,
    threadTitle: `Thread ${index}`,
    reportedAt,
    overallConfidence: 70,
    overallConfidenceReason: "Evidence verified.",
    toolReliability: {
      score: 80,
      failedTools: [],
      unreliableTools: [],
    },
    contextPressure: "adequate",
    skillsUsed: ["web-search"],
    skillsNeedingClarity: [],
    skillsNeedingAccess: [],
    capabilitiesLacking: [{
      name: "browser",
      importance: "important",
      detail: "Browser access was unavailable.",
    }],
    capabilitiesVital: [{
      name: "shell",
      currentState: "available",
    }],
    memoryRecallScore: 60,
    fileLocatabilityScore: 90,
    persistentBlockers: [],
    ...overrides,
  };
}

function modelSnapshot(
  index: number,
  reportedAt: string,
) {
  return {
    id: `snapshot-${index}`,
    sessionId: `session-${index}`,
    reportedAt,
    confidence: 70,
    toolReliability: 80,
    memoryRecall: 60,
    fileLocatability: 90,
    contextPressure: "adequate",
  };
}

test("Overview caps active and recent sessions while retaining totals", () => {
  const sessions = [
    ...Array.from({ length: 4 }, (_, index) =>
      modelSession(index, { status: index === 0 ? "running" : "working" }),
    ),
    ...Array.from({ length: 6 }, (_, index) =>
      modelSession(index + 10, { status: "completed" }),
    ),
    modelSession(99, { generated: true, status: "running" }),
  ];
  const overview = buildFamiliarOverview({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    tasks: [],
    sessions,
    reminders: [],
    healRequests: [],
    now: NOW,
  });
  assert.equal(overview.sessions.active.length, 3);
  assert.equal(overview.sessions.activeTotal, 4);
  assert.equal(overview.sessions.recent.length, 5);
  assert.equal(overview.sessions.recentTotal, 6);
  assert.equal(overview.sessions.totalNonGenerated, 10);
});

test("Analytics bounds evidence, reports, and the trailing metric window", () => {
  const sessions = Array.from({ length: 130 }, (_, index) =>
    modelSession(index),
  );
  const reports = Array.from({ length: 40 }, (_, index) =>
    modelReport(index),
  );
  const snapshots = [
    ...Array.from({ length: 120 }, (_, index) =>
      modelSnapshot(index, new Date(NOW - index * 60_000).toISOString()),
    ),
    modelSnapshot(999, new Date(NOW - 31 * 24 * 60 * 60_000).toISOString()),
  ];
  const analytics = buildFamiliarAnalyticsDigest({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    sessions,
    reports,
    reportTotal: 40,
    snapshots,
    snapshotTotal: 121,
    memories: [],
    memoryAvailability: "ready",
    retroState: null,
    contractReport: null,
    feedback: { up: 4, down: 2, total: 6, models: [], runtimes: [] },
    now: NOW,
  });
  assert.equal(analytics.activity.evidenceCount, 100);
  assert.equal(analytics.confidence.sampleCount, 30);
  assert.equal(analytics.confidence.latestReportAt, reports[0].reportedAt);
  assert.equal(analytics.trends.sampleCount, 100);
  assert.equal(analytics.trends.period, "last 30 days");
  assert.equal(analytics.feedback.state, "stable");
});

test("Analytics distinguishes unavailable memory from ready-empty memory", () => {
  const input = {
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    sessions: [],
    reports: [],
    reportTotal: 0,
    snapshots: [],
    snapshotTotal: 0,
    memories: [],
    retroState: null,
    contractReport: null,
    feedback: { up: 0, down: 0, total: 0, models: [], runtimes: [] },
    now: NOW,
  };
  const unavailable = buildFamiliarAnalyticsDigest({
    ...input,
    memoryAvailability: "unavailable",
  });
  const ready = buildFamiliarAnalyticsDigest({
    ...input,
    memoryAvailability: "ready",
  });
  assert.deepEqual(
    { availability: unavailable.memory.availability, count: unavailable.memory.count },
    { availability: "unavailable", count: null },
  );
  assert.deepEqual(
    { availability: ready.memory.availability, count: ready.memory.count },
    { availability: "ready", count: 0 },
  );
});

test("Analytics exposes used, lacking, vital, heal, and regression evidence", () => {
  const report = modelReport(0);
  const analytics = buildFamiliarAnalyticsDigest({
    familiarId: "sage",
    familiar: { id: "sage", display_name: "Sage", role: "Researcher" },
    sessions: [],
    reports: [report],
    reportTotal: 1,
    snapshots: [],
    snapshotTotal: 0,
    memories: [],
    memoryAvailability: "ready",
    retroState: null,
    contractReport: {
      specVersion: "0.1.0",
      pass: false,
      properties: [{
        property: "Defined Purpose",
        pass: false,
      }],
      violations: [{
        file: "SOUL.md",
        field: "purpose",
        message: "Purpose is missing.",
      }],
      warnings: [],
    },
    feedback: { up: 2, down: 3, total: 5, models: [], runtimes: [] },
    now: NOW,
  });
  assert.deepEqual(analytics.capabilities.used, [{
    name: "web-search",
    count: 1,
  }]);
  assert.equal(analytics.capabilities.lacking[0].name, "browser");
  assert.equal(analytics.capabilities.vital[0].name, "shell");
  assert.equal(analytics.healRequests.length, 1);
  assert.equal(analytics.feedback.state, "regressing");
});

test("Profile projects every approved identity and access field", () => {
  const profile = buildFamiliarProfile({
    familiar: {
      id: "sage",
      display_name: "Sage",
      role: "Researcher",
      description: "Finds evidence.",
      pronouns: "they/them",
      icon: "ph:book-open-fill",
      emoji: "📚",
      color: "violet",
      familiarType: "researcher",
      status: "online",
      memory_freshness: "2026-08-07T19:00:00.000Z",
      harness: "codex",
      defaultHarness: "claude",
      harnessOverride: "codex",
      model: "gpt-5.3-codex",
      voiceProvider: "elevenlabs",
      voiceModel: "multilingual-v2",
      voiceName: "Sage",
      imageProvider: "openai",
      imageModel: "gpt-image-2",
      imageSize: "1024x1024",
      imageQuality: "high",
      note: "Prefer primary sources.",
      autoSelfReport: true,
      asanaEnabled: false,
      asanaWorkspaceGid: "workspace-1",
      xResearchEnabled: true,
      xPublishEnabled: false,
      omnigent: {
        agentId: "agent-1",
        hostId: "host-1",
        workspace: "/work/sage",
      },
    },
    config: {
      defaults: { harness: "claude", model: "claude-sonnet" },
      familiars: { sage: { model: "gpt-5.3-codex", asanaEnabled: false } },
    },
    files: {
      soul: "# Sage\n\n## Purpose\nFind and verify primary evidence.",
      identity: null,
      ward: null,
      memory: null,
    },
    contractReport: {
      specVersion: "0.1.0",
      pass: true,
      properties: [{
        property: "Defined Purpose",
        pass: true,
      }],
      violations: [],
      warnings: [],
    },
    projects: [{
      project: { id: "cave", name: "Coven Cave", root: "/repo" },
      access: "write",
    }],
  });
  assert.equal(profile.description, "Finds evidence.");
  assert.equal(profile.purpose, "Find and verify primary evidence.");
  assert.deepEqual(profile.glyph, {
    icon: "ph:book-open-fill",
    emoji: "📚",
    color: "violet",
  });
  assert.equal(profile.runtime.modelProvenance, "familiar");
  assert.equal(profile.memoryFreshness, "2026-08-07T19:00:00.000Z");
  assert.equal(profile.voice.name, "Sage");
  assert.equal(profile.image.model, "gpt-image-2");
  assert.equal(profile.configuration.autoSelfReport, true);
  assert.equal(profile.configuration.omnigent.agentId, "agent-1");
  assert.equal(profile.contract.propertyPassed, 1);
  assert.deepEqual(profile.access.projects.items, [{
    id: "cave",
    name: "Coven Cave",
    access: "write",
  }]);
  assert.deepEqual(
    profile.access.tools.map((tool) => [tool.id, tool.enabled]),
    [["asana", false], ["x-research", true], ["x-publish", false]],
  );
});
```

In `scripts/run-tests.mjs`, make these exact insertions.

In `TEST_SUITES.api`, replace:

```js
    "src/lib/server/sessions-list-cache.test.ts",
    "src/lib/server/session-security.test.ts",
```

with:

```js
    "src/lib/server/sessions-list-cache.test.ts",
    "src/lib/familiar-dashboard.test.ts",
    "src/lib/server/session-security.test.ts",
```

In `ALIAS_LOADER`, replace:

```js
  "src/lib/familiar-growth-signals.test.ts",
  "src/lib/familiar-growth-route-wiring.test.ts",
```

with:

```js
  "src/lib/familiar-growth-signals.test.ts",
  "src/lib/familiar-dashboard.test.ts",
  "src/lib/familiar-growth-route-wiring.test.ts",
```

- [ ] **Step 2: Run the model test and verify it fails**

Run:

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/familiar-dashboard.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/lib/familiar-dashboard.ts`.

- [ ] **Step 3: Define the public DTO, issue codes, and byte helper**

Create `src/lib/familiar-dashboard.ts` with these public declarations:

```ts
export const FAMILIAR_DASHBOARD_VERSION = 1 as const;
export const FAMILIAR_DASHBOARD_LIMITS = {
  responseBytes: 128 * 1024,
  assignedTasks: 6,
  activeSessions: 3,
  recentSessions: 5,
  attention: 6,
  reminders: 5,
  reports: 30,
  metricSnapshots: 100,
  metricTrailingDays: 30,
  sessionEvidence: 100,
  sessionPulseDays: 14,
} as const;

export type ServerDashboardSectionState =
  | "fresh"
  | "partial"
  | "empty"
  | "unavailable";
export type ClientDashboardSectionState =
  | ServerDashboardSectionState
  | "stale";

export type FamiliarDashboardSource =
  | "familiar"
  | "board"
  | "sessions"
  | "inbox"
  | "contract"
  | "access"
  | "memory"
  | "retro"
  | "self_reports"
  | "metric_snapshots"
  | "feedback";

export type FamiliarDashboardIssueCode =
  | "familiar_enrichment_unavailable"
  | "board_unavailable"
  | "sessions_unavailable"
  | "sessions_degraded"
  | "inbox_unavailable"
  | "contract_unavailable"
  | "access_unavailable"
  | "memory_unavailable"
  | "retro_roster_unavailable"
  | "retro_state_unavailable"
  | "self_reports_unavailable"
  | "metric_snapshots_unavailable"
  | "feedback_unavailable";

export type FamiliarDashboardIssue = {
  source: FamiliarDashboardSource;
  code: FamiliarDashboardIssueCode;
};

export type DashboardSection<T> = {
  state: ServerDashboardSectionState;
  generatedAt: string;
  data: T | null;
  issues: FamiliarDashboardIssue[];
};

export type FamiliarDashboardResponse =
  | {
      ok: true;
      version: 1;
      familiarId: string;
      generatedAt: string;
      identity: FamiliarDashboardIdentity;
      sections: {
        overview: DashboardSection<FamiliarOverview>;
        profile: DashboardSection<FamiliarProfile>;
        analytics: DashboardSection<FamiliarAnalyticsDigest>;
      };
    }
  | {
      ok: false;
      error:
        | "invalid_familiar_id"
        | "dashboard_unauthorized"
        | "familiar_not_found"
        | "dashboard_unavailable";
    };

export function serializedDashboardBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
```

Define DTOs with explicit fields rather than re-exporting `Familiar`, `Card`, `SessionRow`, `InboxItem`, or analytics internals:

```ts
export type FamiliarDashboardIdentity = {
  id: string;
  displayName: string;
  role: string;
  pronouns: string | null;
  avatarUrl: string | null;
  avatarRevision: string | null;
  presence: string | null;
  lastSeen: string | null;
  activeSessionCount: number | null;
};

export type FamiliarOverview = {
  live: {
    presence: string | null;
    harness: string | null;
    model: string | null;
    activeSessionCount: number | null;
    memoryFreshness: string | null;
    generatedAt: string;
  };
  now:
    | { kind: "session"; id: string; title: string; updatedAt: string }
    | { kind: "task"; id: string; title: string; nextStep: string; updatedAt: string }
    | { kind: "idle"; label: "No active work" };
  tasks: { items: FamiliarDashboardTask[]; total: number };
  sessions: {
    active: FamiliarDashboardSession[];
    activeTotal: number;
    recent: FamiliarDashboardSession[];
    recentTotal: number;
    totalNonGenerated: number;
  };
  attention: { items: FamiliarDashboardAttention[]; total: number };
  reminders: { items: FamiliarDashboardReminder[]; total: number };
};

export type FamiliarDashboardTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  sessionId: string | null;
  updatedAt: string;
  dependencies: TaskDependency[];
  primaryBlocker: TaskDependency | null;
  nextStep: TaskNextStep | null;
};

export type FamiliarProfile = {
  description: string | null;
  purpose: string | null;
  familiarType: string | null;
  glyph: {
    icon: string | null;
    emoji: string | null;
    color: string | null;
  };
  runtime: {
    harness: string | null;
    defaultHarness: string | null;
    harnessOverride: string | null;
    model: string | null;
    modelProvenance: "familiar" | "coven_default" | "unconfigured";
  };
  memoryFreshness: string | null;
  voice: { provider: string | null; model: string | null; name: string | null };
  image: {
    provider: string | null;
    model: string | null;
    size: string | null;
    quality: string | null;
  };
  configuration: {
    note: string | null;
    autoSelfReport: boolean;
    omnigent: {
      agentId: string | null;
      hostId: string | null;
      workspace: string | null;
    } | null;
  };
  contract: FamiliarContractSummary | null;
  access: FamiliarAccessSummary | null;
};

export type FamiliarAnalyticsDigest = {
  activity: FamiliarActivityDigest;
  confidence: FamiliarConfidenceDigest;
  trends: FamiliarTrendDigest;
  memory: FamiliarMemoryDigest;
  capabilities: FamiliarCapabilityDigest;
  healRequests: FamiliarDashboardHealRequest[];
  feedback: FamiliarFeedbackDigest;
};
```

Import `TaskDependency` and `TaskNextStep` as types from `cave-board-types.ts`; all other public dashboard rows must be dashboard-owned DTOs.

- [ ] **Step 4: Implement deterministic section state construction**

Add:

```ts
export type DashboardSourceSuccess<T> = { ok: true; data: T };
export type DashboardSourceFailure<T = never> = {
  ok: false;
  source: FamiliarDashboardSource;
  code: FamiliarDashboardIssueCode;
  data?: T;
};
export type DashboardSourceResult<T> =
  | DashboardSourceSuccess<T>
  | DashboardSourceFailure<T>;

export function buildDashboardSection<T>({
  generatedAt,
  required,
  optional,
  data,
  empty,
}: {
  generatedAt: string;
  required: DashboardSourceResult<unknown>[];
  optional: DashboardSourceResult<unknown>[];
  data: T | null;
  empty: boolean;
}): DashboardSection<T> {
  const failures = [...required, ...optional].filter(
    (result): result is DashboardSourceFailure<unknown> => !result.ok,
  );
  const requiredFailed = required.some((result) => !result.ok);
  const state: ServerDashboardSectionState =
    data === null
      ? requiredFailed
        ? "unavailable"
        : "empty"
      : requiredFailed
        ? "partial"
        : empty
          ? "empty"
          : "fresh";
  return {
    state,
    generatedAt,
    data,
    issues: failures.map(({ source, code }) => ({ source, code })),
  };
}
```

Optional failures appear in `issues` but do not change `fresh` to `partial`, matching the approved state table.
The optional `data` on a failure carries safe degraded data: sessions can retain local rows with `sessions_degraded`, and retro can retain successful Familiar states while reporting one unavailable state.

- [ ] **Step 5: Implement pure Overview selection, sorting, and bounds**

Add these imports to `src/lib/familiar-dashboard.ts`:

```ts
import { ACTIVE_SESSION_STATUSES } from "@/lib/chat-auto-archive";
import { isGeneratedChatSession } from "@/lib/chat-projects";
import type {
  Card,
  TaskDependency,
  TaskNextStep,
} from "@/lib/cave-board-types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { SelfHealRequest } from "@/lib/familiar-heal-requests";
import type { Familiar, SessionRow } from "@/lib/types";
```

Add these declarations and bodies:

```ts
export type FamiliarDashboardSession = {
  id: string;
  title: string;
  status: string;
  harness: string;
  model: string | null;
  updatedAt: string;
};

export type FamiliarDashboardReminder = {
  id: string;
  familiarId: string;
  title: string;
  body: string | null;
  status: string;
  fireAt: string | null;
  updatedAt: string;
};

export type FamiliarDashboardHealRequest = {
  id: string;
  severity: SelfHealRequest["severity"];
  title: string;
  detail: string;
  suggestedAction: string;
  actionKind: SelfHealRequest["actionKind"];
};

export type FamiliarDashboardAttention = {
  id: string;
  source: "task" | "heal" | "reminder";
  severity: "info" | "warn" | "crit";
  title: string;
  detail: string;
  target: {
    kind: "task" | "analytics" | "reminder";
    id: string;
  };
  updatedAt: string;
};

function dashboardTask(card: Card): FamiliarDashboardTask {
  const dependencies = card.dependencies ?? [];
  return {
    id: card.id,
    title: card.title,
    status: card.status,
    priority: card.priority,
    sessionId: card.sessionId,
    updatedAt: card.updatedAt,
    dependencies,
    primaryBlocker:
      dependencies.find((dependency) => dependency.id === card.primaryBlockerId) ?? null,
    nextStep: card.nextStep ?? null,
  };
}

function dashboardSession(session: SessionRow): FamiliarDashboardSession {
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    harness: session.harness,
    model: session.model ?? null,
    updatedAt: session.updated_at,
  };
}

function dashboardReminder(item: InboxItem): FamiliarDashboardReminder {
  return {
    id: item.id,
    familiarId: item.familiarId as string,
    title: item.title,
    body: item.body ?? null,
    status: item.status,
    fireAt: item.fireAt ?? null,
    updatedAt: item.updatedAt,
  };
}

function newestFirst<T>(
  left: T,
  right: T,
  timestamp: (value: T) => string,
): number {
  return Date.parse(timestamp(right)) - Date.parse(timestamp(left));
}

const TASK_PRIORITY_RANK: Record<Card["priority"], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function buildFamiliarOverview({
  familiarId,
  familiar,
  tasks,
  sessions,
  reminders,
  healRequests,
  now,
}: {
  familiarId: string;
  familiar: Familiar;
  tasks: Card[];
  sessions: SessionRow[];
  reminders: InboxItem[];
  healRequests: FamiliarDashboardHealRequest[];
  now: number;
}): FamiliarOverview {
  const generatedAt = new Date(now).toISOString();
  const assignedTasks = tasks
    .filter((card) => card.familiarId === familiarId && card.status !== "done")
    .sort(
      (left, right) =>
        TASK_PRIORITY_RANK[left.priority] - TASK_PRIORITY_RANK[right.priority] ||
        newestFirst(left, right, (card) => card.updatedAt),
    );
  const visibleSessions = sessions
    .filter(
      (session) =>
        session.familiarId === familiarId &&
        !isGeneratedChatSession(session),
    )
    .sort((left, right) =>
      newestFirst(left, right, (session) => session.updated_at),
    );
  const activeSessions = visibleSessions.filter((session) =>
    ACTIVE_SESSION_STATUSES.has((session.status ?? "").toLowerCase()),
  );
  const recentSessions = visibleSessions.filter(
    (session) =>
      !ACTIVE_SESSION_STATUSES.has((session.status ?? "").toLowerCase()),
  );
  const scopedReminders = reminders
    .filter(
      (item) =>
        item.kind === "reminder" &&
        item.familiarId === familiarId,
    )
    .sort(
      (left, right) =>
        Number(right.status === "fired") - Number(left.status === "fired") ||
        newestFirst(left, right, (item) => item.updatedAt),
    );
  const runningSession = activeSessions.find(
    (session) => session.status.toLowerCase() === "running",
  );
  const nextTask = assignedTasks.find(
    (card) => Boolean(card.nextStep?.summary.trim()),
  );

  const taskAttention: FamiliarDashboardAttention[] = assignedTasks
    .filter((card) => card.status === "review" || card.status === "blocked")
    .map((card) => ({
      id: `task:${card.id}`,
      source: "task",
      severity: card.status === "blocked" ? "crit" : "warn",
      title: card.title,
      detail:
        card.status === "blocked"
          ? card.nextStep?.summary ?? "Resolve the primary blocker."
          : "Review the assigned task.",
      target: { kind: "task", id: card.id },
      updatedAt: card.updatedAt,
    }));
  const healAttention: FamiliarDashboardAttention[] = healRequests
    .map((request) => ({
      id: `heal:${request.id}`,
      source: "heal",
      severity: request.severity,
      title: request.title,
      detail: request.detail,
      target: { kind: "analytics", id: request.id },
      updatedAt: request.createdAt,
    }));
  const reminderAttention: FamiliarDashboardAttention[] = scopedReminders
    .filter((item) => item.status === "fired")
    .map((item) => ({
      id: `reminder:${item.id}`,
      source: "reminder",
      severity: "warn",
      title: item.title,
      detail: item.body ?? "Reminder is due.",
      target: { kind: "reminder", id: item.id },
      updatedAt: item.updatedAt,
    }));
  const attention = [
    ...taskAttention,
    ...healAttention,
    ...reminderAttention,
  ].sort((left, right) =>
    newestFirst(left, right, (item) => item.updatedAt),
  );

  return {
    live: {
      presence: familiar.status ?? null,
      harness: familiar.harness ?? null,
      model: familiar.model ?? null,
      activeSessionCount: familiar.active_sessions ?? null,
      memoryFreshness: familiar.memory_freshness ?? null,
      generatedAt,
    },
    now: runningSession
      ? {
          kind: "session",
          id: runningSession.id,
          title: runningSession.title,
          updatedAt: runningSession.updated_at,
        }
      : nextTask
        ? {
            kind: "task",
            id: nextTask.id,
            title: nextTask.title,
            nextStep: nextTask.nextStep!.summary,
            updatedAt: nextTask.updatedAt,
          }
        : { kind: "idle", label: "No active work" },
    tasks: {
      items: assignedTasks
        .slice(0, FAMILIAR_DASHBOARD_LIMITS.assignedTasks)
        .map(dashboardTask),
      total: assignedTasks.length,
    },
    sessions: {
      active: activeSessions
        .slice(0, FAMILIAR_DASHBOARD_LIMITS.activeSessions)
        .map(dashboardSession),
      activeTotal: activeSessions.length,
      recent: recentSessions
        .slice(0, FAMILIAR_DASHBOARD_LIMITS.recentSessions)
        .map(dashboardSession),
      recentTotal: recentSessions.length,
      totalNonGenerated: visibleSessions.length,
    },
    attention: {
      items: attention.slice(0, FAMILIAR_DASHBOARD_LIMITS.attention),
      total: attention.length,
    },
    reminders: {
      items: scopedReminders
        .slice(0, FAMILIAR_DASHBOARD_LIMITS.reminders)
        .map(dashboardReminder),
      total: scopedReminders.length,
    },
  };
}
```

- [ ] **Step 6: Implement Profile and Analytics builders**

Add these imports to `src/lib/familiar-dashboard.ts`:

```ts
import {
  buildFamiliarCardStats,
  type CanonicalMemoryAvailability,
} from "@/components/familiars-view-stats";
import type { CanonicalMemorySummary } from "@/lib/canonical-memory";
import type { FamiliarBinding } from "@/lib/cave-config";
import type { CaveProject } from "@/lib/cave-projects-types";
import type { ContractFiles, ContractReport } from "@/lib/familiar-contract";
import { deriveGrowthReport } from "@/lib/familiar-growth-signals";
import { deriveHealRequests } from "@/lib/familiar-heal-requests";
import type { MessageFeedbackRollup } from "@/lib/message-feedback-rollup";
import type { ProjectAccessLevel } from "@/lib/project-permissions";
import type { RetroFamiliarState } from "@/lib/retro-runs";
import { buildSessionPulse } from "@/lib/session-pulse";
import {
  deriveSignalTrends,
  type ThreadMetricSnapshot,
} from "@/lib/signal-trends";
import {
  aggregateThreadSignals,
  type ThreadSelfReport,
} from "@/lib/thread-self-report";
import { deriveThreadConfidence } from "@/lib/thread-confidence";
```

Add these DTOs:

```ts
export type FamiliarContractSummary = {
  specVersion: string;
  pass: boolean;
  propertyPassed: number;
  propertyTotal: number;
  violationCount: number;
  warningCount: number;
};

export type FamiliarAccessSummary = {
  projects: {
    items: Array<{
      id: string;
      name: string;
      access: ProjectAccessLevel;
    }>;
    total: number;
  };
  tools: Array<{
    id: "asana" | "x-research" | "x-publish";
    enabled: boolean;
    provenance: "inherited" | "explicit";
    workspaceGid: string | null;
  }>;
};

type AnalyticsMetadata = {
  definition: string;
  period: string;
  sampleCount: number;
  freshness: string | null;
};

export type FamiliarActivityDigest = AnalyticsMetadata & {
  pulse: ReturnType<typeof buildSessionPulse>;
  activeSessions: number;
  totalSessions: number;
  lastActiveAt: string | null;
  evidenceCount: number;
};

export type FamiliarConfidenceDigest = AnalyticsMetadata & {
  band: ReturnType<typeof deriveThreadConfidence>["label"] | null;
  latestReportAt: string | null;
  insufficientData: boolean;
};

export type FamiliarTrendDigest = AnalyticsMetadata & {
  granularity: ReturnType<typeof deriveSignalTrends>["granularity"];
  metrics: ReturnType<typeof deriveSignalTrends>["metrics"];
  buckets: ReturnType<typeof deriveSignalTrends>["buckets"];
};

export type FamiliarMemoryDigest = AnalyticsMetadata & {
  availability: CanonicalMemoryAvailability;
  count: number | null;
  latestUpdatedAt: string | null;
  averageRecall: number | null;
  averageFileLocatability: number | null;
};

export type FamiliarCapabilityDigest = AnalyticsMetadata & {
  used: Array<{ name: string; count: number }>;
  lacking: ReturnType<typeof aggregateThreadSignals>["capabilitiesLacking"];
  vital: ReturnType<typeof aggregateThreadSignals>["capabilitiesVital"];
};

export type FamiliarFeedbackDigest = AnalyticsMetadata & {
  state: "insufficient" | "regressing" | "stable";
  up: number;
  down: number;
  total: number;
  models: MessageFeedbackRollup["models"];
  runtimes: MessageFeedbackRollup["runtimes"];
};
```

Add these helpers and complete builders:

```ts
function purposeFromSoul(soul: string | null): string | null {
  if (!soul) return null;
  const lines = soul.split(/\r?\n/);
  const purposeHeading = lines.findIndex((line) =>
    /^##\s+Purpose\s*$/i.test(line.trim()),
  );
  if (purposeHeading >= 0) {
    for (const line of lines.slice(purposeHeading + 1)) {
      const trimmed = line.trim();
      if (/^##\s+/.test(trimmed)) break;
      if (trimmed) return trimmed;
    }
  }
  const sentence = soul.match(/\bMy purpose is ([^\r\n]+)/i);
  return sentence?.[1]?.trim() ?? null;
}

function modelProvenance(
  familiarId: string,
  config: {
    defaults: Pick<FamiliarBinding, "model">;
    familiars: Record<string, Partial<FamiliarBinding>>;
  },
): FamiliarProfile["runtime"]["modelProvenance"] {
  if (config.familiars[familiarId]?.model?.trim()) return "familiar";
  if (config.defaults.model?.trim()) return "coven_default";
  return "unconfigured";
}

export function buildFamiliarProfile({
  familiar,
  config,
  files,
  contractReport,
  projects,
}: {
  familiar: Familiar;
  config: {
    defaults: Pick<FamiliarBinding, "model">;
    familiars: Record<string, Partial<FamiliarBinding>>;
  };
  files: ContractFiles;
  contractReport: ContractReport | null;
  projects: Array<{ project: CaveProject; access: ProjectAccessLevel }>;
}): FamiliarProfile {
  const rawAsana = config.familiars[familiar.id]?.asanaEnabled;
  return {
    description: familiar.description ?? null,
    purpose: purposeFromSoul(files.soul),
    familiarType: familiar.familiarType ?? null,
    glyph: {
      icon: familiar.icon ?? null,
      emoji: familiar.emoji ?? null,
      color: familiar.color ?? null,
    },
    runtime: {
      harness: familiar.harness ?? null,
      defaultHarness: familiar.defaultHarness ?? null,
      harnessOverride: familiar.harnessOverride ?? null,
      model: familiar.model ?? null,
      modelProvenance: modelProvenance(familiar.id, config),
    },
    memoryFreshness: familiar.memory_freshness ?? null,
    voice: {
      provider: familiar.voiceProvider ?? null,
      model: familiar.voiceModel ?? null,
      name: familiar.voiceName ?? null,
    },
    image: {
      provider: familiar.imageProvider ?? null,
      model: familiar.imageModel ?? null,
      size: familiar.imageSize ?? null,
      quality: familiar.imageQuality ?? null,
    },
    configuration: {
      note: familiar.note ?? null,
      autoSelfReport: familiar.autoSelfReport === true,
      omnigent: familiar.omnigent
        ? {
            agentId: familiar.omnigent.agentId ?? null,
            hostId: familiar.omnigent.hostId ?? null,
            workspace: familiar.omnigent.workspace ?? null,
          }
        : null,
    },
    contract: contractReport
      ? {
          specVersion: contractReport.specVersion,
          pass: contractReport.pass,
          propertyPassed: contractReport.properties.filter(
            (property) => property.pass,
          ).length,
          propertyTotal: contractReport.properties.length,
          violationCount: contractReport.violations.length,
          warningCount: contractReport.warnings.length,
        }
      : null,
    access: {
      projects: {
        items: projects.map(({ project, access }) => ({
          id: project.id,
          name: project.name,
          access,
        })),
        total: projects.length,
      },
      tools: [
        {
          id: "asana",
          enabled: familiar.asanaEnabled !== false,
          provenance: rawAsana === undefined ? "inherited" : "explicit",
          workspaceGid: familiar.asanaWorkspaceGid ?? null,
        },
        {
          id: "x-research",
          enabled: familiar.xResearchEnabled === true,
          provenance: "explicit",
          workspaceGid: null,
        },
        {
          id: "x-publish",
          enabled: familiar.xPublishEnabled === true,
          provenance: "explicit",
          workspaceGid: null,
        },
      ],
    },
  };
}

export function buildFamiliarAnalyticsDigest({
  familiarId,
  familiar,
  sessions,
  reports,
  reportTotal,
  snapshots,
  snapshotTotal,
  memories,
  memoryAvailability,
  retroState,
  contractReport,
  feedback,
  now,
}: {
  familiarId: string;
  familiar: Familiar;
  sessions: SessionRow[];
  reports: ThreadSelfReport[];
  reportTotal: number;
  snapshots: ThreadMetricSnapshot[];
  snapshotTotal: number;
  memories: CanonicalMemorySummary[];
  memoryAvailability: CanonicalMemoryAvailability;
  retroState: RetroFamiliarState | null;
  contractReport: ContractReport | null;
  feedback: MessageFeedbackRollup;
  now: number;
}): FamiliarAnalyticsDigest {
  const nonGeneratedSessions = sessions
    .filter(
      (session) =>
        session.familiarId === familiarId &&
        !isGeneratedChatSession(session),
    )
    .sort((left, right) =>
      newestFirst(left, right, (session) => session.updated_at),
    );
  const evidenceSessions = nonGeneratedSessions.slice(
    0,
    FAMILIAR_DASHBOARD_LIMITS.sessionEvidence,
  );
  const boundedReports = [...reports]
    .sort((left, right) =>
      Date.parse(right.reportedAt) - Date.parse(left.reportedAt),
    )
    .slice(0, FAMILIAR_DASHBOARD_LIMITS.reports);
  const metricCutoff =
    now - FAMILIAR_DASHBOARD_LIMITS.metricTrailingDays * 24 * 60 * 60_000;
  const boundedSnapshots = snapshots
    .filter((snapshot) => {
      const reportedAt = Date.parse(snapshot.reportedAt);
      return reportedAt >= metricCutoff && reportedAt <= now;
    })
    .sort((left, right) =>
      Date.parse(right.reportedAt) - Date.parse(left.reportedAt),
    )
    .slice(0, FAMILIAR_DASHBOARD_LIMITS.metricSnapshots)
    .sort((left, right) =>
      Date.parse(left.reportedAt) - Date.parse(right.reportedAt),
    );
  const reportAggregate = aggregateThreadSignals(boundedReports);
  const confidence = deriveThreadConfidence(boundedReports);
  const pulse = buildSessionPulse(
    evidenceSessions,
    familiarId,
    now,
    FAMILIAR_DASHBOARD_LIMITS.sessionPulseDays,
  );
  const trends = deriveSignalTrends(
    boundedSnapshots,
    now,
    undefined,
    { days: 30, label: "last 30 days" },
  );
  const scopedMemories = memories.filter(
    (memory) => memory.familiarId === familiarId,
  );
  const stats = buildFamiliarCardStats({
    familiars: [familiar],
    sessions: nonGeneratedSessions,
    covenEntries: scopedMemories,
    memoryAvailability,
    now,
  }).get(familiarId)!;
  const growth = deriveGrowthReport({ familiar, stats, retroState, now });
  const healRequests = deriveHealRequests({
    familiarId,
    contractReport,
    growthReport: growth,
  });
  const latestReportAt = boundedReports[0]?.reportedAt ?? null;
  const latestMemoryAt = scopedMemories
    .map((memory) => memory.updatedAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  const feedbackState =
    feedback.total < 5
      ? "insufficient"
      : feedback.up / feedback.total < 0.6
        ? "regressing"
        : "stable";

  return {
    activity: {
      definition: "Non-generated Familiar sessions by UTC calendar day.",
      period: "last 14 days",
      sampleCount: evidenceSessions.length,
      freshness: evidenceSessions[0]?.updated_at ?? null,
      pulse,
      activeSessions: nonGeneratedSessions.filter((session) =>
        ACTIVE_SESSION_STATUSES.has((session.status ?? "").toLowerCase()),
      ).length,
      totalSessions: nonGeneratedSessions.length,
      lastActiveAt: evidenceSessions[0]?.updated_at ?? null,
      evidenceCount: evidenceSessions.length,
    },
    confidence: {
      definition: "Named band derived from the latest thread self-reports.",
      period: "latest 30 reports",
      sampleCount: boundedReports.length,
      freshness: latestReportAt,
      band: confidence.hasData ? confidence.label : null,
      latestReportAt,
      insufficientData: !confidence.hasData,
    },
    trends: {
      definition: "Metric direction across persisted thread snapshots.",
      period: trends.scopeLabel,
      sampleCount: trends.snapshotCount,
      freshness: boundedSnapshots.at(-1)?.reportedAt ?? null,
      granularity: trends.granularity,
      metrics: trends.metrics,
      buckets: trends.buckets,
    },
    memory: {
      definition: "Canonical memory availability and report-backed recall signals.",
      period: "current memory plus latest 30 reports",
      sampleCount: boundedReports.length,
      freshness: latestMemoryAt,
      availability: memoryAvailability,
      count: memoryAvailability === "ready" ? scopedMemories.length : null,
      latestUpdatedAt: latestMemoryAt,
      averageRecall:
        boundedReports.length > 0
          ? reportAggregate.averageMemoryRecall
          : null,
      averageFileLocatability:
        boundedReports.length > 0
          ? reportAggregate.averageFileLocatability
          : null,
    },
    capabilities: {
      definition: "Capabilities observed across the latest thread self-reports.",
      period: "latest 30 reports",
      sampleCount: boundedReports.length,
      freshness: latestReportAt,
      used: reportAggregate.skillsUsedMost.map(({ skillId, count }) => ({
        name: skillId,
        count,
      })),
      lacking: reportAggregate.capabilitiesLacking,
      vital: reportAggregate.capabilitiesVital,
    },
    healRequests: healRequests.map((request) => ({
      id: request.id,
      severity: request.severity,
      title: request.title,
      detail: request.detail,
      suggestedAction: request.suggestedAction,
      actionKind: request.actionKind,
    })),
    feedback: {
      definition: "Final thumbs verdicts for messages attributed to this Familiar.",
      period: "all retained feedback",
      sampleCount: feedback.total,
      freshness: null,
      state: feedbackState,
      up: feedback.up,
      down: feedback.down,
      total: feedback.total,
      models: feedback.models,
      runtimes: feedback.runtimes,
    },
  };
}
```

The builder intentionally does not return `confidence.score` or
`trends.overall`. `reportTotal` and `snapshotTotal` remain inputs so the
aggregate loader can preserve store totals in future compatible DTO additions;
version 1 publishes the bounded sample counts instead.

- [ ] **Step 7: Run the focused model test**

Run:

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/familiar-dashboard.test.ts
```

Expected: all model tests pass, including every cap, total, state, UTC 14-day pulse, 30-day metric window, and no-composite-score assertion.

- [ ] **Step 8: Commit the shared model**

```bash
git add src/lib/familiar-dashboard.ts src/lib/familiar-dashboard.test.ts scripts/run-tests.mjs
git commit -m "feat: define familiar dashboard contract"
```

---

### Task 4: Implement the dependency-injected aggregate loader

**Files:**
- Create: `src/lib/server/familiar-dashboard-data.ts`
- Create: `src/lib/server/familiar-dashboard-data.test.ts`
- Modify: `src/lib/familiar-heal-requests.ts`
- Modify: `src/lib/familiar-heal-requests.test.ts`
- Modify: `src/lib/message-feedback-rollup.ts`
- Modify: `src/lib/message-feedback-rollup.test.ts`
- Modify: `src/lib/server/canonical-memory-gateway.ts`
- Modify: `src/lib/server/canonical-memory-gateway.test.ts`
- Modify: `src/lib/server/familiar-self-reports.ts`
- Modify: `src/lib/server/familiar-self-reports.test.ts`
- Modify: `src/lib/server/message-feedback-store.ts`
- Modify: `src/lib/server/message-feedback-store.test.ts`
- Modify: `scripts/run-tests.mjs:1363-1364,1766-1768`

- [ ] **Step 1: Write failing aggregate-loader tests**

Create `src/lib/server/familiar-dashboard-data.test.ts` with a `makeDependencies()` fixture whose defaults return one known Familiar and empty successful sources. Override one dependency per test.

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FAMILIAR_DASHBOARD_LIMITS,
  serializedDashboardBytes,
} from "../familiar-dashboard.ts";
import {
  loadFamiliarDashboard,
  type FamiliarDashboardDependencies,
} from "./familiar-dashboard-data.ts";

const NOW = Date.parse("2026-08-07T20:00:00.000Z");
const CONFIG = {
  version: 1,
  defaults: { harness: "claude", model: "claude-sonnet" },
  familiars: { sage: { model: "gpt-5.3-codex" } },
  roles: [],
  marketplace: { installed: {} },
  multiHost: { mode: "local", hubUrl: "", executorUrls: [] },
  omnigent: {
    enabled: false,
    baseUrl: "",
    defaultAgentId: "",
    defaultHostId: "",
    defaultWorkspace: "",
    hostMap: {},
    hostWorkspaceMap: {},
    exposeHostsInComposer: false,
  },
  remoteHosts: [],
};

function makeDependencies(
  overrides: Partial<FamiliarDashboardDependencies> = {},
): FamiliarDashboardDependencies {
  return {
    now: () => NOW,
    loadRoster: async () => ({
      ok: true,
      config: CONFIG,
      target: {
        mode: "local",
        label: "Local daemon",
        socketPath: "/var/run/coven.sock",
      },
      roster: [{
        id: "sage",
        display_name: "Sage",
        role: "Researcher",
        status: "online",
        active_sessions: 1,
      }],
    }),
    enrichFamiliar: async (familiar) => ({
      ...familiar,
      harness: "claude",
      defaultHarness: "claude",
      harnessOverride: null,
      model: "gpt-5.3-codex",
    }),
    loadBoard: async () => ({ version: 1, cards: [] }),
    loadSessions: async () => ({ payload: { ok: true, sessions: [] } }),
    loadInbox: async () => ({ version: 1, items: [] }),
    loadContract: async () => ({
      files: { soul: null, identity: null, ward: null, memory: null },
      report: {
        specVersion: "0.1.0",
        pass: false,
        properties: [],
        violations: [],
        warnings: [],
      },
    }),
    loadAccess: async () => ({ projects: [] }),
    loadMemory: async () => ({
      entries: [],
      overview: {
        generatedAt: new Date(NOW).toISOString(),
        totals: {
          entries: 0,
          familiars: 0,
          verified: 0,
          needsReview: 0,
          unknown: 0,
        },
        lastUpdatedAt: null,
        capabilities: {
          detail: true,
          verification: true,
          attestationMetadata: true,
          supersessionHistory: true,
          mutations: true,
        },
        verification: {
          state: "verified",
          checkedAt: new Date(NOW).toISOString(),
          manifest: null,
          index: null,
          issues: [],
        },
      },
    }),
    loadRetro: async () => ({
      ok: true,
      snapshot: {
        generatedAt: new Date(NOW).toISOString(),
        summary: {
          totalRuns: 0,
          accepted: 0,
          reverted: 0,
          runningFamiliars: 0,
          familiarsWithData: 0,
          trackCounts: { synthesis: 0, prompt: 0, memory: 0 },
          lastRun: null,
        },
        familiars: [],
        runs: [],
      },
    }),
    loadReports: async () => ({ reports: [], total: 0 }),
    loadMetricSnapshots: async () => ({ snapshots: [], total: 0 }),
    loadFeedback: async () => [],
    ...overrides,
  };
}

function taskFixture(index: number) {
  const updatedAt = new Date(NOW - index * 60_000).toISOString();
  return {
    id: `task-${index}`,
    title: `Task ${index}`,
    notes: "",
    status: "running",
    priority: "medium",
    familiarId: "sage",
    sessionId: null,
    cwd: null,
    links: [],
    github: [],
    asana: [],
    labels: [],
    createdAt: updatedAt,
    updatedAt,
    lifecycle: "running",
    lifecycleAt: updatedAt,
    retryCount: 0,
    maxRetries: 2,
    steps: [],
    dependencies: [],
    primaryBlockerId: null,
    nextStep: {
      summary: "Continue the assigned task",
      requiresApproval: false,
      origin: "human",
      updatedAt,
    },
  };
}

function sessionFixture(index: number) {
  const updatedAt = new Date(NOW - index * 60_000).toISOString();
  return {
    id: `session-${index}`,
    project_root: "/repo",
    harness: "claude",
    model: "claude-sonnet",
    runtime: "local",
    title: `Session ${index}`,
    status: index === 0 ? "running" : "completed",
    exit_code: 0,
    archived_at: null,
    created_at: updatedAt,
    updated_at: updatedAt,
    familiarId: "sage",
    origin: "chat",
    generated: false,
  };
}

function reminderFixture(index: number) {
  const updatedAt = new Date(NOW - index * 60_000).toISOString();
  return {
    id: `reminder-${index}`,
    kind: "reminder",
    title: `Reminder ${index}`,
    body: null,
    status: "pending",
    createdAt: updatedAt,
    updatedAt,
    fireAt: null,
    recurrence: { type: "none" },
    source: "user",
    familiarId: "sage",
  };
}

function reportFixture(index: number) {
  const reportedAt = new Date(NOW - index * 60_000).toISOString();
  return {
    id: `report-${index}`,
    familiarId: "sage",
    sessionId: `session-${index}`,
    threadTitle: `Thread ${index}`,
    reportedAt,
    overallConfidence: 70,
    overallConfidenceReason: "Evidence verified.",
    toolReliability: {
      score: 80,
      failedTools: [],
      unreliableTools: [],
    },
    contextPressure: "adequate",
    skillsUsed: ["web-search"],
    skillsNeedingClarity: [],
    skillsNeedingAccess: [],
    capabilitiesLacking: [],
    capabilitiesVital: [{
      name: "shell",
      currentState: "available",
    }],
    memoryRecallScore: 60,
    fileLocatabilityScore: 90,
    persistentBlockers: [],
  };
}

function snapshotFixture(index: number) {
  return {
    id: `snapshot-${index}`,
    sessionId: `session-${index}`,
    reportedAt: new Date(NOW - index * 60_000).toISOString(),
    confidence: 70,
    toolReliability: 80,
    memoryRecall: 60,
    fileLocatability: 90,
    contextPressure: "adequate",
  };
}

test("unknown Familiar stops after roster resolution", async () => {
  let boardCalls = 0;
  const result = await loadFamiliarDashboard("missing", makeDependencies({
    loadBoard: async () => {
      boardCalls++;
      return { version: 1, cards: [] };
    },
  }));
  assert.deepEqual(result, { kind: "not_found" });
  assert.equal(boardCalls, 0);
});

test("known Familiar returns 200-shaped partial data when one source fails", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadBoard: async () => {
      throw new Error("/Users/private/board.json token=secret");
    },
  }));
  assert.equal(result.kind, "ok");
  assert.equal(result.response.sections.overview.state, "partial");
  assert.deepEqual(result.response.sections.overview.issues, [{
    source: "board",
    code: "board_unavailable",
  }]);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("successful record sources produce fresh sections", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadBoard: async () => ({
      version: 1,
      cards: [taskFixture(0)],
    }),
    loadSessions: async () => ({
      payload: { ok: true, sessions: [sessionFixture(0)] },
    }),
    loadInbox: async () => ({
      version: 1,
      items: [reminderFixture(0)],
    }),
    loadReports: async () => ({
      reports: [reportFixture(0)],
      total: 1,
    }),
    loadMetricSnapshots: async () => ({
      snapshots: [snapshotFixture(0)],
      total: 1,
    }),
  }));
  assert.equal(result.kind, "ok");
  assert.equal(result.response.sections.overview.state, "fresh");
  assert.equal(result.response.sections.profile.state, "fresh");
  assert.equal(result.response.sections.analytics.state, "fresh");
});

test("successful empty stores produce truthful empty data states", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies());
  assert.equal(result.kind, "ok");
  assert.equal(result.response.sections.overview.state, "empty");
  assert.equal(result.response.sections.overview.data.tasks.total, 0);
  assert.equal(result.response.sections.analytics.state, "empty");
  assert.equal(result.response.sections.analytics.data.activity.totalSessions, 0);
  assert.equal(result.response.sections.profile.state, "fresh");
});

test("every source failure is independent", async () => {
  const dependencyKeys = [
    "enrichFamiliar",
    "loadBoard",
    "loadSessions",
    "loadInbox",
    "loadContract",
    "loadAccess",
    "loadMemory",
    "loadRetro",
    "loadReports",
    "loadMetricSnapshots",
    "loadFeedback",
  ];
  for (const key of dependencyKeys) {
    const result = await loadFamiliarDashboard("sage", makeDependencies({
      [key]: async () => { throw new Error(`raw-${key}-secret`); },
    }));
    assert.equal(result.kind, "ok", `${key} does not erase the known Familiar`);
    assert.equal(JSON.stringify(result).includes(`raw-${key}-secret`), false);
  }
});

test("multiple failures affect only the sections that consume them", async () => {
  const fail = async () => { throw new Error("private failure detail"); };
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadBoard: fail,
    loadReports: fail,
  }));
  assert.equal(result.kind, "ok");
  assert.equal(result.response.sections.overview.state, "partial");
  assert.equal(result.response.sections.analytics.state, "partial");
  assert.equal(result.response.sections.profile.state, "fresh");
  assert.equal(JSON.stringify(result).includes("private failure detail"), false);
});

test("all required Overview sources failing yields unavailable only for Overview", async () => {
  const fail = async () => { throw new Error("source failed"); };
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadBoard: fail,
    loadSessions: fail,
    loadInbox: fail,
  }));
  assert.equal(result.kind, "ok");
  assert.equal(result.response.sections.overview.state, "unavailable");
  assert.equal(result.response.sections.overview.data, null);
  assert.notEqual(result.response.sections.profile.state, "unavailable");
});

test("degraded local sessions remain usable and make required sections partial", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadSessions: async () => ({
      payload: {
        ok: true,
        degraded: true,
        error: "daemon token=secret",
        sessions: [sessionFixture(0)],
      },
    }),
  }));
  assert.equal(result.kind, "ok");
  assert.equal(result.response.sections.overview.state, "partial");
  assert.equal(result.response.sections.overview.data.sessions.totalNonGenerated, 1);
  assert.deepEqual(
    result.response.sections.overview.issues.find(
      (issue) => issue.source === "sessions",
    ),
    { source: "sessions", code: "sessions_degraded" },
  );
  assert.equal(JSON.stringify(result).includes("daemon token=secret"), false);
});

test("roster failure yields no safe dashboard", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadRoster: async () => ({
      ok: false,
      config: CONFIG,
      target: {
        mode: "local",
        label: "Local daemon",
        socketPath: "/var/run/coven.sock",
      },
      status: 503,
      error: "daemon token=secret",
    }),
  }));
  assert.deepEqual(result, { kind: "unavailable" });
});

test("production bounds are applied before serialization", async () => {
  const result = await loadFamiliarDashboard("sage", makeDependencies({
    loadReports: async () => ({
      reports: Array.from({ length: 40 }, (_, index) => reportFixture(index)),
      total: 40,
    }),
    loadMetricSnapshots: async () => ({
      snapshots: Array.from({ length: 140 }, (_, index) => snapshotFixture(index)),
      total: 140,
    }),
    loadSessions: async () => ({
      payload: {
        ok: true,
        sessions: Array.from({ length: 130 }, (_, index) => sessionFixture(index)),
      },
    }),
  }));
  assert.equal(result.kind, "ok");
  assert.ok(
    serializedDashboardBytes(result.response) <= FAMILIAR_DASHBOARD_LIMITS.responseBytes,
  );
  assert.equal(result.response.sections.analytics.data.confidence.sampleCount, 30);
  assert.ok(result.response.sections.analytics.data.trends.sampleCount <= 100);
});
```

In `scripts/run-tests.mjs`, make these exact insertions.

In `TEST_SUITES.api`, replace:

```js
    "src/lib/server/sessions-list-cache.test.ts",
    "src/lib/familiar-dashboard.test.ts",
    "src/lib/server/session-security.test.ts",
```

with:

```js
    "src/lib/server/sessions-list-cache.test.ts",
    "src/lib/familiar-dashboard.test.ts",
    "src/lib/server/familiar-dashboard-data.test.ts",
    "src/lib/server/session-security.test.ts",
```

In `ALIAS_LOADER`, replace:

```js
  "src/lib/familiar-growth-signals.test.ts",
  "src/lib/familiar-dashboard.test.ts",
  "src/lib/familiar-growth-route-wiring.test.ts",
```

with:

```js
  "src/lib/familiar-growth-signals.test.ts",
  "src/lib/familiar-dashboard.test.ts",
  "src/lib/server/familiar-dashboard-data.test.ts",
  "src/lib/familiar-growth-route-wiring.test.ts",
```

- [ ] **Step 2: Run the aggregate test and verify the missing-module failure**

Run:

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/familiar-dashboard-data.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `familiar-dashboard-data.ts`.

- [ ] **Step 3: Define dependencies and stable source capture**

Create `src/lib/server/familiar-dashboard-data.ts` with this exact import block,
then the declarations below it:

```ts
import { loadBoard } from "@/lib/cave-board";
import { loadInbox } from "@/lib/cave-inbox";
import { loadProjects } from "@/lib/cave-projects";
import type { CaveProject } from "@/lib/cave-projects-types";
import {
  canonicalMemoryList,
  canonicalMemoryOverview,
} from "@/lib/server/canonical-memory-gateway";
import type {
  CanonicalMemoryOverview,
  CanonicalMemorySummary,
} from "@/lib/canonical-memory";
import {
  evaluateFamiliarContract,
  type ContractFiles,
  type ContractReport,
} from "@/lib/familiar-contract";
import {
  buildDashboardSection,
  buildFamiliarAnalyticsDigest,
  buildFamiliarOverview,
  buildFamiliarProfile,
  FAMILIAR_DASHBOARD_LIMITS,
  FAMILIAR_DASHBOARD_VERSION,
  type DashboardSourceResult,
  type FamiliarDashboardIssueCode,
  type FamiliarDashboardResponse,
  type FamiliarDashboardSource,
} from "@/lib/familiar-dashboard";
import { rollupMessageFeedback } from "@/lib/message-feedback-rollup";
import {
  listAccessibleProjects,
  type ProjectAccessLevel,
} from "@/lib/project-permissions";
import {
  enrichFamiliar,
} from "@/lib/server/familiar-enrichment";
import {
  readFamiliarContractFiles,
} from "@/lib/server/familiar-contract-files";
import {
  loadVisibleFamiliarRoster,
} from "@/lib/server/familiar-roster";
import {
  listMetricSnapshots,
  listSelfReports,
} from "@/lib/server/familiar-self-reports";
import {
  loadMessageFeedback,
} from "@/lib/server/message-feedback-store";
import {
  loadRetroRunsSnapshot,
  type RetroRunsSnapshotResult,
} from "@/lib/server/retro-runs-snapshot";
import {
  computeSessionsList,
} from "@/lib/server/sessions-list";
import type { SessionsListResult } from "@/lib/server/sessions-list-cache";

export type FamiliarDashboardDependencies = {
  now: () => number;
  loadRoster: typeof loadVisibleFamiliarRoster;
  enrichFamiliar: typeof enrichFamiliar;
  loadBoard: typeof loadBoard;
  loadSessions: (
    includeArchived: boolean,
    familiarId: string | null,
    collapseFamiliarWorkspace: boolean,
  ) => Promise<SessionsListResult>;
  loadInbox: typeof loadInbox;
  loadContract: (id: string) => Promise<{
    files: ContractFiles;
    report: ContractReport;
  }>;
  loadAccess: (id: string) => Promise<{
    projects: { project: CaveProject; access: ProjectAccessLevel }[];
  }>;
  loadMemory: (familiarId: string) => Promise<CanonicalMemorySummary[]>;
  loadRetro: (args: { familiarId: string }) => Promise<RetroRunsSnapshotResult>;
  loadReports: (id: string) => ReturnType<typeof listDashboardSelfReports>;
  loadMetricSnapshots: (id: string) => ReturnType<typeof listDashboardMetricSnapshots>;
  loadFeedback: (args: {
    familiarId: string;
  }) => Promise<MessageFeedbackRollupSnapshot>;
};

async function capture<T>(
  source: FamiliarDashboardSource,
  code: FamiliarDashboardIssueCode,
  load: () => Promise<T>,
): Promise<DashboardSourceResult<T>> {
  try {
    return { ok: true, data: await load() };
  } catch {
    return { ok: false, source, code };
  }
}

function sourceData<T>(
  result: DashboardSourceResult<T>,
  fallback: T,
): T {
  return result.ok ? result.data : result.data ?? fallback;
}
```

Do not retain an exception object, message, stack, filesystem path, daemon status text, task title, session title, reminder body, or profile biography in a failure result.

- [ ] **Step 4: Implement production defaults from authoritative stores**

Keep the production defaults in the same module:

```ts
const DEFAULT_FAMILIAR_DASHBOARD_DEPENDENCIES: FamiliarDashboardDependencies = {
  now: Date.now,
  loadRoster: loadVisibleFamiliarRoster,
  enrichFamiliar,
  loadBoard,
  loadSessions: loadCachedSessionsList,
  loadInbox,
  loadContract: async (id) => {
    const { files } = await readFamiliarContractFiles(id);
    return { files, report: evaluateFamiliarContract(files) };
  },
  loadAccess: async (id) => ({
    projects: await listAccessibleProjects(await loadProjects(), id),
  }),
  loadMemory: loadCachedCanonicalMemorySummariesForFamiliar,
  loadRetro: ({ familiarId }) => loadRetroRunsSnapshot({ familiarId }),
  loadReports: listDashboardSelfReports,
  loadMetricSnapshots: listDashboardMetricSnapshots,
  loadFeedback: ({ familiarId }) => loadDashboardMessageFeedback({ familiarId }),
};
```

Use the existing shared sessions source cache here on purpose: `loadCachedSessionsList`
is the authoritative 2s-fresh / 30s stale-while-revalidate cache for the
side-effecting session computation, so the dashboard does not duplicate daemon
and git recomputes. That cache is a **source cache** beneath the aggregate
loader — it is not the dashboard snapshot cache and it is not the client
section `stale` state. Likewise, memory reads stay on the familiar-scoped
cached canonical-memory summaries loader, report/snapshot reads stay on the
dashboard-bounded readers, and feedback stays on the dashboard-specific
bounded snapshot/rollup helper. The server section-state contract above remains
unchanged.

- [ ] **Step 5: Implement roster-first identity resolution and parallel source loading**

Append this complete outcome type and loader:

```ts
export type FamiliarDashboardLoadResult =
  | { kind: "ok"; response: Extract<FamiliarDashboardResponse, { ok: true }> }
  | { kind: "not_found" }
  | { kind: "unavailable" };

export async function loadFamiliarDashboard(
  familiarId: string,
  dependencies: FamiliarDashboardDependencies = DEFAULT_DEPENDENCIES,
): Promise<FamiliarDashboardLoadResult> {
  let rosterResult: Awaited<ReturnType<typeof dependencies.loadRoster>>;
  try {
    rosterResult = await dependencies.loadRoster();
  } catch {
    return { kind: "unavailable" };
  }
  if (!rosterResult.ok) return { kind: "unavailable" };

  const rosterEntry = rosterResult.roster.find(
    (familiar) => familiar.id === familiarId,
  );
  if (!rosterEntry) return { kind: "not_found" };

  const now = dependencies.now();
  const generatedAt = new Date(now).toISOString();
  const [
    enrichmentSource,
    boardSource,
    sessionsLoadSource,
    inboxSource,
    contractSource,
    accessSource,
    memorySource,
    retroLoadSource,
    reportsSource,
    snapshotsSource,
    feedbackEntriesSource,
  ] = await Promise.all([
    capture(
      "familiar",
      "familiar_enrichment_unavailable",
      () => dependencies.enrichFamiliar(rosterEntry, rosterResult.config),
    ),
    capture("board", "board_unavailable", dependencies.loadBoard),
    capture(
      "sessions",
      "sessions_unavailable",
      () => dependencies.loadSessions(false, familiarId, false),
    ),
    capture("inbox", "inbox_unavailable", dependencies.loadInbox),
    capture(
      "contract",
      "contract_unavailable",
      () => dependencies.loadContract(familiarId),
    ),
    capture(
      "access",
      "access_unavailable",
      () => dependencies.loadAccess(familiarId),
    ),
    capture("memory", "memory_unavailable", dependencies.loadMemory),
    capture(
      "retro",
      "retro_state_unavailable",
      () => dependencies.loadRetro({ familiarId }),
    ),
    capture(
      "self_reports",
      "self_reports_unavailable",
      () => dependencies.loadReports(familiarId),
    ),
    capture(
      "metric_snapshots",
      "metric_snapshots_unavailable",
      () => dependencies.loadMetricSnapshots(familiarId),
    ),
    capture("feedback", "feedback_unavailable", dependencies.loadFeedback),
  ]);

  const sessionsSource: DashboardSourceResult<
    Extract<SessionsListResult["payload"], { ok: true }>["sessions"]
  > = sessionsLoadSource.ok
    ? sessionsLoadSource.data.payload.ok
      ? sessionsLoadSource.data.payload.degraded
        ? {
            ok: false,
            source: "sessions",
            code: "sessions_degraded",
            data: sessionsLoadSource.data.payload.sessions,
          }
        : {
            ok: true,
            data: sessionsLoadSource.data.payload.sessions,
          }
      : {
          ok: false,
          source: "sessions",
          code: "sessions_unavailable",
        }
    : {
        ok: false,
        source: "sessions",
        code: "sessions_unavailable",
      };

  const retroSource: DashboardSourceResult<
    RetroRunsSnapshotResult["snapshot"]
  > = retroLoadSource.ok
    ? retroLoadSource.data.ok
      ? { ok: true, data: retroLoadSource.data.snapshot }
      : {
          ok: false,
          source: "retro",
          code: retroLoadSource.data.code,
          data: retroLoadSource.data.snapshot,
        }
    : {
        ok: false,
        source: "retro",
        code: "retro_state_unavailable",
      };

  const feedbackSource: DashboardSourceResult<
    ReturnType<typeof rollupMessageFeedback>
  > = feedbackEntriesSource.ok
    ? {
        ok: true,
        data: rollupMessageFeedback(feedbackEntriesSource.data, { familiarId }),
      }
    : {
        ok: false,
        source: "feedback",
        code: "feedback_unavailable",
      };

  const scopedSessions = sourceData(sessionsSource, [])
    .filter((session) => session.familiarId === familiarId)
    .sort(
      (left, right) =>
        Date.parse(right.updated_at) - Date.parse(left.updated_at),
    );
  const metricCutoff =
    now - FAMILIAR_DASHBOARD_LIMITS.metricTrailingDays * 24 * 60 * 60_000;
  const boundedSnapshots = sourceData(
    snapshotsSource,
    { snapshots: [], total: 0 },
  ).snapshots
    .filter((snapshot) => {
      const reportedAt = Date.parse(snapshot.reportedAt);
      return reportedAt >= metricCutoff && reportedAt <= now;
    })
    .sort(
      (left, right) =>
        Date.parse(right.reportedAt) - Date.parse(left.reportedAt),
    )
    .slice(0, FAMILIAR_DASHBOARD_LIMITS.metricSnapshots)
    .sort(
      (left, right) =>
        Date.parse(left.reportedAt) - Date.parse(right.reportedAt),
    );

  const board = sourceData(boardSource, { version: 1, cards: [] });
  const inbox = sourceData(inboxSource, { version: 1, items: [] });
  const contract = contractSource.ok
    ? contractSource.data
    : {
        files: { soul: null, identity: null, ward: null, memory: null },
        report: null,
      };
  const access = sourceData(accessSource, { projects: [] });
  const memory = memorySource.ok
    ? memorySource.data
    : { entries: [], overview: null };
  const retroSnapshot = sourceData(retroSource, {
    generatedAt,
    summary: {
      totalRuns: 0,
      accepted: 0,
      reverted: 0,
      runningFamiliars: 0,
      familiarsWithData: 0,
      trackCounts: { synthesis: 0, prompt: 0, memory: 0 },
      lastRun: null,
    },
    familiars: [],
    runs: [],
  });
  const reports = sourceData(reportsSource, { reports: [], total: 0 });
  const feedback = sourceData(feedbackSource, {
    up: 0,
    down: 0,
    total: 0,
    models: [],
    runtimes: [],
  });
  const familiar = enrichmentSource.ok
    ? enrichmentSource.data
    : rosterEntry;
  const overviewRequired = [boardSource, sessionsSource, inboxSource];
  const overviewOptional = [
    contractSource,
    memorySource,
    retroSource,
    reportsSource,
  ];
  const profileRequired = [enrichmentSource, contractSource, accessSource];
  const profileOptional = [memorySource];
  const analyticsRequired = [
    sessionsSource,
    reportsSource,
    snapshotsSource,
    memorySource,
  ];
  const analyticsOptional = [contractSource, retroSource, feedbackSource];
  const overviewAvailable = overviewRequired.some((source) => source.ok);
  const analyticsAvailable = analyticsRequired.some((source) => source.ok);
  const builtAnalytics = buildFamiliarAnalyticsDigest({
    familiarId,
    familiar,
    sessions: scopedSessions,
    reports: reports.reports,
    reportTotal: reports.total,
    snapshots: boundedSnapshots,
    snapshotTotal: sourceData(
      snapshotsSource,
      { snapshots: [], total: 0 },
    ).total,
    memories: memory.entries,
    memoryAvailability: memorySource.ok ? "ready" : "unavailable",
    retroState:
      retroSnapshot.familiars.find(
        (state) => state.familiarId === familiarId,
      ) ?? null,
    contractReport: contract.report,
    feedback,
    now,
  });
  const analyticsData = analyticsAvailable ? builtAnalytics : null;
  const overviewData = overviewAvailable
    ? buildFamiliarOverview({
        familiarId,
        familiar,
        tasks: board.cards,
        sessions: scopedSessions,
        reminders: inbox.items,
        healRequests: builtAnalytics.healRequests,
        now,
      })
    : null;
  const profileData = buildFamiliarProfile({
    familiar,
    config: rosterResult.config,
    files: contract.files,
    contractReport: contract.report,
    projects: access.projects,
  });
  const overview = buildDashboardSection({
    generatedAt,
    required: overviewRequired,
    optional: overviewOptional,
    data: overviewData,
    empty:
      overviewData !== null &&
      overviewData.tasks.total === 0 &&
      overviewData.sessions.totalNonGenerated === 0 &&
      overviewData.reminders.total === 0 &&
      overviewData.attention.total === 0,
  });
  const profile = buildDashboardSection({
    generatedAt,
    required: profileRequired,
    optional: profileOptional,
    data: profileData,
    empty: false,
  });
  const analytics = buildDashboardSection({
    generatedAt,
    required: analyticsRequired,
    optional: analyticsOptional,
    data: analyticsData,
    empty:
      analyticsData !== null &&
      analyticsData.activity.totalSessions === 0 &&
      analyticsData.confidence.sampleCount === 0 &&
      analyticsData.trends.sampleCount === 0 &&
      analyticsData.memory.count === 0,
  });

  const avatarUrl = familiar.avatarUrl ?? null;
  return {
    kind: "ok",
    response: {
      ok: true,
      version: FAMILIAR_DASHBOARD_VERSION,
      familiarId,
      generatedAt,
      identity: {
        id: familiarId,
        displayName: familiar.display_name,
        role: familiar.role,
        pronouns: familiar.pronouns ?? null,
        avatarUrl,
        avatarRevision: avatarUrl
          ? new URL(avatarUrl, "http://cave.local").searchParams.get("v")
          : null,
        presence: familiar.status ?? null,
        lastSeen: familiar.last_seen ?? null,
        activeSessionCount: familiar.active_sessions ?? null,
      },
      sections: { overview, profile, analytics },
    },
  };
}
```

- [ ] **Step 6: Verify the aggregate boundary**

Keep response-byte enforcement out of
`src/lib/server/familiar-dashboard-data.ts`; Step 3 of Task 5 performs the
single final serialized-byte check after the route has the complete success
response.

- [ ] **Step 7: Run the aggregate tests**

Run:

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/familiar-dashboard-data.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/familiar-dashboard.test.ts
```

Expected: both tests pass. The aggregate test proves every dependency can fail without leaking its thrown message and that only roster failure prevents a safe known-Familiar snapshot.

- [ ] **Step 8: Commit the aggregate loader**

```bash
git add src/lib/server/familiar-dashboard-data.ts src/lib/server/familiar-dashboard-data.test.ts scripts/run-tests.mjs
git commit -m "feat: aggregate familiar dashboard data"
```

---

### Task 5: Add the route, API contracts, test wiring, and final validation

**Files:**
- Create: `src/app/api/familiars/[id]/dashboard/route.ts`
- Create: `src/app/api/familiars/[id]/dashboard/route.test.ts`
- Modify: `src/app/api/api-contracts.test.ts`
- Modify: `scripts/run-tests.mjs:1214-1216,1631-1634`

- [ ] **Step 1: Write the failing route test**

Create `src/app/api/familiars/[id]/dashboard/route.test.ts`. Export a dependency-injected `handleDashboardRequest` from the route so behavior can be tested without real daemon/filesystem calls.

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  FAMILIAR_DASHBOARD_LIMITS,
  FAMILIAR_DASHBOARD_VERSION,
} from "../../../../../lib/familiar-dashboard.ts";
import { handleDashboardRequest } from "./route.ts";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

function successResponseFixture({
  overviewState = "fresh",
  profileState = "fresh",
  analyticsState = "fresh",
}: {
  overviewState?: "fresh" | "partial" | "empty" | "unavailable";
  profileState?: "fresh" | "partial" | "empty" | "unavailable";
  analyticsState?: "fresh" | "partial" | "empty" | "unavailable";
}) {
  const generatedAt = "2026-08-07T20:00:00.000Z";
  return {
    ok: true,
    version: FAMILIAR_DASHBOARD_VERSION,
    familiarId: "sage",
    generatedAt,
    identity: {
      id: "sage",
      displayName: "Sage",
      role: "Researcher",
      pronouns: "they/them",
      avatarUrl: null,
      avatarRevision: null,
      presence: "online",
      lastSeen: generatedAt,
      activeSessionCount: 1,
    },
    sections: {
      overview: {
        state: overviewState,
        generatedAt,
        data: overviewState === "unavailable"
          ? null
          : {
              live: {
                presence: "online",
                harness: "claude",
                model: "claude-sonnet",
                activeSessionCount: 1,
                memoryFreshness: generatedAt,
                generatedAt,
              },
              now: { kind: "idle", label: "No active work" },
              tasks: { items: [], total: 0 },
              sessions: {
                active: [],
                activeTotal: 0,
                recent: [],
                recentTotal: 0,
                totalNonGenerated: 0,
              },
              attention: { items: [], total: 0 },
              reminders: { items: [], total: 0 },
            },
        issues: [],
      },
      profile: {
        state: profileState,
        generatedAt,
        data: profileState === "unavailable"
          ? null
          : {
              description: "Finds evidence.",
              purpose: "Find and verify primary evidence.",
              familiarType: "researcher",
              glyph: { icon: null, emoji: null, color: null },
              runtime: {
                harness: "claude",
                defaultHarness: "claude",
                harnessOverride: null,
                model: "claude-sonnet",
                modelProvenance: "coven_default",
              },
              memoryFreshness: generatedAt,
              voice: { provider: null, model: null, name: null },
              image: {
                provider: null,
                model: null,
                size: null,
                quality: null,
              },
              configuration: {
                note: null,
                autoSelfReport: false,
                omnigent: null,
              },
              contract: {
                specVersion: "0.1.0",
                pass: true,
                propertyPassed: 5,
                propertyTotal: 5,
                violationCount: 0,
                warningCount: 0,
              },
              access: {
                projects: { items: [], total: 0 },
                tools: [
                  {
                    id: "asana",
                    enabled: true,
                    provenance: "inherited",
                    workspaceGid: null,
                  },
                  {
                    id: "x-research",
                    enabled: false,
                    provenance: "explicit",
                    workspaceGid: null,
                  },
                  {
                    id: "x-publish",
                    enabled: false,
                    provenance: "explicit",
                    workspaceGid: null,
                  },
                ],
              },
            },
        issues: [],
      },
      analytics: {
        state: analyticsState,
        generatedAt,
        data: analyticsState === "unavailable"
          ? null
          : {
              activity: {
                definition: "Non-generated Familiar sessions by UTC calendar day.",
                period: "last 14 days",
                sampleCount: 0,
                freshness: null,
                pulse: [],
                activeSessions: 0,
                totalSessions: 0,
                lastActiveAt: null,
                evidenceCount: 0,
              },
              confidence: {
                definition: "Named band derived from the latest thread self-reports.",
                period: "latest 30 reports",
                sampleCount: 0,
                freshness: null,
                band: null,
                latestReportAt: null,
                insufficientData: true,
              },
              trends: {
                definition: "Metric direction across persisted thread snapshots.",
                period: "last 30 days",
                sampleCount: 0,
                freshness: null,
                granularity: "day",
                metrics: [],
                buckets: [],
              },
              memory: {
                definition: "Canonical memory availability and report-backed recall signals.",
                period: "current memory plus latest 30 reports",
                sampleCount: 0,
                freshness: null,
                availability: "ready",
                count: 0,
                latestUpdatedAt: null,
                averageRecall: null,
                averageFileLocatability: null,
              },
              capabilities: {
                definition: "Capabilities observed across the latest thread self-reports.",
                period: "latest 30 reports",
                sampleCount: 0,
                freshness: null,
                used: [],
                lacking: [],
                vital: [],
              },
              healRequests: [],
              feedback: {
                definition: "Final thumbs verdicts for messages attributed to this Familiar.",
                period: "all retained feedback",
                sampleCount: 0,
                freshness: null,
                state: "insufficient",
                up: 0,
                down: 0,
                total: 0,
                models: [],
                runtimes: [],
              },
            },
        issues: [],
      },
    },
  };
}

test("invalid Familiar id returns 403 with a stable code", async () => {
  let calls = 0;
  const response = await handleDashboardRequest(
    new Request("http://cave.local/api/familiars/../dashboard?v=1"),
    { params: Promise.resolve({ id: "../sage" }) },
    async () => {
      calls++;
      return { kind: "unavailable" };
    },
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "invalid_familiar_id",
  });
  assert.equal(calls, 0);
});

test("unknown Familiar returns 404", async () => {
  const response = await handleDashboardRequest(
    new Request("http://cave.local/api/familiars/missing/dashboard?v=1"),
    { params: Promise.resolve({ id: "missing" }) },
    async () => ({ kind: "not_found" }),
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "familiar_not_found",
  });
});

test("an explicit unsupported version returns 400 before loading", async () => {
  let calls = 0;
  const response = await handleDashboardRequest(
    new Request("http://cave.local/api/familiars/sage/dashboard?v=2"),
    { params: Promise.resolve({ id: "sage" }) },
    async () => {
      calls++;
      return { kind: "not_found" };
    },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "dashboard_unavailable",
  });
  assert.equal(calls, 0);
});

test("a missing version returns 400 before loading", async () => {
  let calls = 0;
  const response = await handleDashboardRequest(
    new Request("http://cave.local/api/familiars/sage/dashboard"),
    { params: Promise.resolve({ id: "sage" }) },
    async () => {
      calls++;
      return { kind: "not_found" };
    },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "dashboard_unavailable",
  });
  assert.equal(calls, 0);
});

test("known Familiar returns 200 even with partial sections", async () => {
  const body = successResponseFixture({
    overviewState: "partial",
    profileState: "fresh",
    analyticsState: "unavailable",
  });
  const response = await handleDashboardRequest(
    new Request("http://cave.local/api/familiars/sage/dashboard?v=1"),
    { params: Promise.resolve({ id: "sage" }) },
    async () => ({ kind: "ok", response: body }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), body);
});

test("no safe dashboard returns 500", async () => {
  const response = await handleDashboardRequest(
    new Request("http://cave.local/api/familiars/sage/dashboard?v=1"),
    { params: Promise.resolve({ id: "sage" }) },
    async () => ({ kind: "unavailable" }),
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "dashboard_unavailable",
  });
});

test("oversized success is replaced by the stable 500 response", async () => {
  const body = successResponseFixture({});
  body.sections.profile.data.description = "x".repeat(
    FAMILIAR_DASHBOARD_LIMITS.responseBytes,
  );
  const response = await handleDashboardRequest(
    new Request("http://cave.local/api/familiars/sage/dashboard?v=1"),
    { params: Promise.resolve({ id: "sage" }) },
    async () => ({ kind: "ok", response: body }),
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "dashboard_unavailable",
  });
});

assert.match(source, /export const dynamic = "force-dynamic"/);
assert.match(source, /export const runtime = "nodejs"/);
assert.doesNotMatch(source, /fetch\(/, "dashboard route must not self-fetch Cave APIs");
```

In `scripts/run-tests.mjs`, make these exact insertions.

In `TEST_SUITES.api`, replace:

```js
    "src/app/api/familiars/route.test.ts",
    "src/lib/server/familiar-enrichment.test.ts",
    "src/app/api/familiars/[id]/avatar/route.test.ts",
```

with:

```js
    "src/app/api/familiars/route.test.ts",
    "src/lib/server/familiar-enrichment.test.ts",
    "src/app/api/familiars/[id]/dashboard/route.test.ts",
    "src/app/api/familiars/[id]/avatar/route.test.ts",
```

In `ALIAS_LOADER`, replace:

```js
  "src/app/api/familiars/route.test.ts",
  "src/lib/server/familiar-enrichment.test.ts",
  "src/lib/server/retro-runs-snapshot.test.ts",
```

with:

```js
  "src/app/api/familiars/route.test.ts",
  "src/lib/server/familiar-enrichment.test.ts",
  "src/app/api/familiars/[id]/dashboard/route.test.ts",
  "src/lib/server/retro-runs-snapshot.test.ts",
```

- [ ] **Step 2: Run the route test and verify the missing-route failure**

Run:

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs 'src/app/api/familiars/[id]/dashboard/route.test.ts'
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `dashboard/route.ts`.

- [ ] **Step 3: Implement the v1 route and response budget**

Create `src/app/api/familiars/[id]/dashboard/route.ts`:

```ts
import { NextResponse } from "next/server";
import {
  FAMILIAR_DASHBOARD_LIMITS,
  serializedDashboardBytes,
} from "@/lib/familiar-dashboard";
import {
  loadFamiliarDashboard,
  type FamiliarDashboardLoadResult,
} from "@/lib/server/familiar-dashboard-data";
import { isValidFamiliarId } from "@/lib/server/familiar-id";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DashboardContext = { params: Promise<{ id: string }> };
type DashboardLoader = (id: string) => Promise<FamiliarDashboardLoadResult>;

const NO_STORE = { "cache-control": "no-store" };

export async function handleDashboardRequest(
  request: Request,
  context: DashboardContext,
  loader: DashboardLoader = loadFamiliarDashboard,
): Promise<Response> {
  const { id } = await context.params;
  if (!id || !isValidFamiliarId(id)) {
    return NextResponse.json(
      { ok: false, error: "invalid_familiar_id" },
      { status: 403, headers: NO_STORE },
    );
  }

  const requestedVersion = new URL(request.url).searchParams.get("v");
  if (requestedVersion !== "1") {
    return NextResponse.json(
      { ok: false, error: "dashboard_unavailable" },
      { status: 400, headers: NO_STORE },
    );
  }

  const result = await loader(id);
  if (result.kind === "not_found") {
    return NextResponse.json(
      { ok: false, error: "familiar_not_found" },
      { status: 404, headers: NO_STORE },
    );
  }
  if (result.kind === "unavailable") {
    return NextResponse.json(
      { ok: false, error: "dashboard_unavailable" },
      { status: 500, headers: NO_STORE },
    );
  }
  if (
    serializedDashboardBytes(result.response) >
    FAMILIAR_DASHBOARD_LIMITS.responseBytes
  ) {
    return NextResponse.json(
      { ok: false, error: "dashboard_unavailable" },
      { status: 500, headers: NO_STORE },
    );
  }
  return NextResponse.json(result.response, { headers: NO_STORE });
}

export async function GET(request: Request, context: DashboardContext) {
  return handleDashboardRequest(request, context);
}
```

The approved route is explicitly versioned as `?v=1`; a missing or non-`1`
value receives the stable 400 response without adding an unapproved error
code.

- [ ] **Step 4: Add dashboard API source-contract assertions**

In the `contracts` array near the top of
`src/app/api/api-contracts.test.ts`, replace:

```ts
  { route: "/familiars/[id]/contract", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/familiars/[id]/icon", methods: ["PUT"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
```

with:

```ts
  { route: "/familiars/[id]/contract", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/familiars/[id]/dashboard", methods: ["GET"], kind: "json", pathGuard: true },
  { route: "/familiars/[id]/icon", methods: ["PUT"], kind: "json", readsJson: true, invalidJson: "fallback-empty" },
```

Append this exact block to `src/app/api/api-contracts.test.ts`:

```ts
{
const dashboardRoute = readFileSync(
  path.join(apiRoot, "familiars", "[id]", "dashboard", "route.ts"),
  "utf8",
);
const dashboardModel = readFileSync(
  path.join(apiRoot, "..", "..", "lib", "familiar-dashboard.ts"),
  "utf8",
);
const dashboardData = readFileSync(
  path.join(
    apiRoot,
    "..",
    "..",
    "lib",
    "server",
    "familiar-dashboard-data.ts",
  ),
  "utf8",
);
const proxySource = readFileSync(
  path.join(apiRoot, "..", "..", "proxy.ts"),
  "utf8",
);
const testRunnerSource = readFileSync(
  path.join(root, "scripts", "run-tests.mjs"),
  "utf8",
);

assert.match(dashboardRoute, /isValidFamiliarId\(id\)/);
assert.match(dashboardRoute, /status: 403/);
assert.match(dashboardRoute, /status: 404/);
assert.match(dashboardRoute, /status: 500/);
assert.match(dashboardRoute, /serializedDashboardBytes/);
assert.match(dashboardRoute, /"cache-control": "no-store"/);
assert.doesNotMatch(dashboardRoute, /fetch\(/);
assert.doesNotMatch(dashboardData, /fetch\(/);
assert.match(dashboardData, /loadBoard/);
assert.match(dashboardData, /computeSessionsList/);
assert.match(dashboardData, /loadInbox/);
assert.match(dashboardData, /canonicalMemoryList/);
assert.match(dashboardData, /canonicalMemoryOverview/);
assert.match(dashboardData, /readFamiliarContractFiles/);
assert.match(dashboardData, /evaluateFamiliarContract/);
assert.match(dashboardData, /listSelfReports/);
assert.match(dashboardData, /listMetricSnapshots/);
assert.match(dashboardData, /loadMessageFeedback/);
assert.match(dashboardData, /rollupMessageFeedback/);
assert.match(dashboardModel, /responseBytes: 128 \* 1024/);
assert.doesNotMatch(
  dashboardData,
  /error:\s*(err|error)\.(message|stack)/,
  "dashboard source failures never serialize raw errors",
);
assert.match(
  proxySource,
  /if \(!req\.nextUrl\.pathname\.startsWith\("\/api\/"\)\)/,
  "the dashboard remains inside the existing authenticated API boundary",
);
assert.doesNotMatch(
  proxySource,
  /HEADER_CSRF_TRUSTED_API_PATHS[\s\S]*dashboard/,
  "the dashboard does not gain a route-specific auth or CSRF exemption",
);
for (const testPath of [
  "src/lib/server/familiar-enrichment.test.ts",
  "src/lib/server/sessions-list.test.ts",
  "src/lib/server/retro-runs-snapshot.test.ts",
  "src/lib/familiar-dashboard.test.ts",
  "src/lib/server/familiar-dashboard-data.test.ts",
  "src/app/api/familiars/[id]/dashboard/route.test.ts",
]) {
  assert.match(
    testRunnerSource,
    new RegExp(testPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `${testPath} is wired into scripts/run-tests.mjs`,
  );
}
}
```

- [ ] **Step 5: Run every new and directly affected focused test**

Run:

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/familiar-enrichment.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/app/api/familiars/route.test.ts
node --experimental-strip-types src/lib/server/sessions-list.test.ts
node --experimental-strip-types src/app/api/sessions/list/route.test.ts
node --experimental-strip-types src/lib/server/sessions-list-cache.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/retro-runs-snapshot.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/familiar-dashboard.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/familiar-dashboard-data.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs 'src/app/api/familiars/[id]/dashboard/route.test.ts'
node --experimental-strip-types src/app/api/api-contracts.test.ts
```

Expected: every command exits 0. No command passes a file path to `pnpm test:api`; `scripts/run-tests.mjs` interprets positional arguments as suite names, not file filters.

- [ ] **Step 6: Run wiring and type validation**

Run:

```bash
pnpm check:tests-wired
pnpm typecheck
```

Expected: both commands exit 0. The earlier `scripts/run-tests.mjs`
replacement blocks already contain every required registration; do not add an
allowlist entry or weaken a type to make either command pass.

- [ ] **Step 7: Run the final API suite**

Run:

```bash
pnpm test:api
```

Expected: the complete API suite passes. This is the only suite-level test command in the plan.

- [ ] **Step 8: Inspect the final diff for phase-one scope and privacy**

Run:

```bash
git diff --check
git diff --name-only
git grep -nE 'raw error|error\\.message|error\\.stack' -- src/lib/familiar-dashboard.ts src/lib/server/familiar-dashboard-data.ts src/app/api/familiars/'[id]'/dashboard/route.ts
```

Expected:

- `git diff --check` prints nothing.
- Changed paths are only those listed in this plan.
- The grep finds no raw-error serialization in the dashboard implementation.
- No Swift, reminder mutation, design spec, goal, or Beads file is changed.

- [ ] **Step 9: Commit the route and final contract wiring**

```bash
git add 'src/app/api/familiars/[id]/dashboard/route.ts' 'src/app/api/familiars/[id]/dashboard/route.test.ts' src/app/api/api-contracts.test.ts scripts/run-tests.mjs
git commit -m "feat: add familiar dashboard endpoint"
```

## Writing-plans self-review

- **Spec coverage:** Tasks 1-5 cover only Bead `cave-9rwd.1`: reusable
  enrichment/session/retro loaders, the versioned DTO and pure builders,
  independent source capture, the authenticated GET route, caps, redaction,
  contract tests, typecheck, and the final API suite. Swift, reminder writes,
  avatar mutation, and web UI remain outside this plan.
- **Completeness scan:** The plan contains no omitted argument lists,
  deferred markers, deferred fixture definitions, or prose-only implementation
  steps. Every remaining three-dot token is TypeScript spread syntax.
- **Type/function consistency:** The plan uses the repository signatures for
  `listAccessibleProjects`, `ProjectAccessLevel`, `ContractReport`,
  `aggregateThreadSignals`, `ACTIVE_SESSION_STATUSES`,
  `isGeneratedChatSession`, `listSelfReports`, `listMetricSnapshots`,
  `canonicalMemoryList`, and `canonicalMemoryOverview`. Every fixture passed to
  `isGeneratedChatSession` has the complete `SessionRow` minimum shape.
- **Test wiring:** Each new test has an exact `TEST_SUITES.api` insertion.
  Tests whose imported module graph reaches `@/` also have an exact insertion
  into the existing `ALIAS_LOADER` set; source-only tests do not.
- **Product decisions:** None remain. The plan implements the approved server
  phase without changing product scope.

## Completion checklist

- [ ] Invalid Familiar IDs return 403 with `invalid_familiar_id`.
- [ ] Unknown Familiars return 404 with `familiar_not_found`.
- [ ] Known Familiars return 200 when sections are partial, empty, or unavailable.
- [ ] Roster auth failures preserve 401 or 403 with `dashboard_unauthorized`.
- [ ] Only non-auth failure to identify/build any safe dashboard, or a payload above 128 KiB, returns 500 `dashboard_unavailable`.
- [ ] Server states are limited to `fresh | partial | empty | unavailable`; `stale` exists only in the client-facing type union.
- [ ] Every issue is a stable `{ source, code }`; raw provider/filesystem/daemon errors are absent.
- [ ] Tasks, sessions, attention, reminders, reports, snapshots, and evidence obey every approved bound and retain totals.
- [ ] Generated sessions are excluded through `isGeneratedChatSession`.
- [ ] Blocked task dependencies, primary blocker, and next step are copied without weakening the orchestration-ready task contract.
- [ ] Profile contains enriched identity/configuration plus contract, project, and tool access summaries.
- [ ] Analytics contains the 14-day pulse, named confidence band/sample, trailing-30-day trends, memory, capability aggregates, heal requests, and feedback without a composite score.
- [ ] The server uses authoritative stores/helpers directly and performs no HTTP self-fetch.
- [ ] The endpoint remains covered by the existing authenticated `/api/*` proxy boundary and adds no auth/CSRF exemption.
- [ ] Source failures are independently injectable and independently represented.
- [ ] All new tests are wired into the `api` suite, targeted commands use Node directly, and `pnpm test:api` passes as the final suite command.
