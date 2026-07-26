# Research Mission Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Turn the Research Desk into a mission-first research factory that launches real familiar work, publishes provenance-rich artifacts, and supports bounded autoresearch through linked Automations.

**Architecture:** Add a server-owned Research Mission workspace and control-plane API over the existing Flow executor, conversation/run evidence, Knowledge Vault, and Codex Automations. The Role Surface routes intent, starts missions, polls reconciled state, and renders missions, artifacts, sources, checkpoints, and loop controls without teaching the generic Cave shell about research.

**Tech Stack:** TypeScript 6, React 19, Next.js 16 App Router, Node filesystem APIs, existing Cave Flow/Knowledge/Automation modules, plain node:test/assert tests through scripts/run-tests.mjs, CSS container queries.

**Execution note:** The repository is on the conservative Beads profile. Run every verification step, but do not execute listed commit commands until Val explicitly authorizes commits.

---

## File map

- Create src/lib/research-missions.ts for client-safe mission types, limits, lifecycle helpers, and API payloads.
- Create src/lib/research-mission-routing.ts for deterministic Auto-mode routing and defaults.
- Create src/lib/research-mission-flow.ts for one bounded Flow iteration.
- Create src/lib/research-artifact-contract.ts for control markers, source/artifact validation, and provenance.
- Create src/lib/server/research-mission-store.ts for safe mission workspaces and atomic persistence.
- Create src/lib/server/research-mission-runner.ts for start, reconcile, lifecycle, publish, and scheduling orchestration.
- Create src/lib/research-mission-client.ts for typed fetch helpers.
- Create src/app/api/research/missions routes for list/create, detail, actions, and schedule.
- Create focused Role Surface composer, list, detail, evidence, and hook modules.
- Modify researcher-surface.tsx, register.tsx, globals.css, API contracts, test wiring, and role-surface docs.

## Slice 1: mission spine and one-shot artifact factory

### Task 1: Define mission types, finite bounds, routing, and actions

**Files:**
- Create: src/lib/research-missions.ts
- Create: src/lib/research-mission-routing.ts
- Create: src/lib/research-missions.test.ts
- Modify: scripts/run-tests.mjs:34-151

- [x] **Step 1: Write the failing model tests**

~~~ts
import assert from "node:assert/strict";
import test from "node:test";
import { defaultResearchPlan, inferResearchMissionMode } from "./research-mission-routing.ts";
import { allowedResearchActions, normalizeResearchBounds } from "./research-missions.ts";

test("Auto-routing is explainable and ambiguous work never loops", () => {
  assert.deepEqual(inferResearchMissionMode("Compare local-first note apps"), {
    mode: "brief",
    reason: "comparison or recommendation request",
  });
  assert.equal(inferResearchMissionMode("Run experiments until accuracy plateaus").mode, "autoresearch");
  assert.equal(inferResearchMissionMode("Research mushrooms").mode, "brief");
});

test("mode defaults are finite", () => {
  assert.equal(defaultResearchPlan("paper").bounds.sourceTarget, 8);
  assert.equal(defaultResearchPlan("autoresearch").bounds.maxIterations, 6);
});

test("active work cannot be double-started", () => {
  assert.deepEqual(allowedResearchActions({ status: "running" }), ["cancel"]);
  assert.deepEqual(
    allowedResearchActions({ status: "checkpoint" }),
    ["continue", "refine", "finish", "cancel", "archive"],
  );
});

test("invalid bounds are rejected", () => {
  assert.equal(normalizeResearchBounds({ wallClockMinutes: Infinity }).ok, false);
  assert.equal(normalizeResearchBounds({ maxIterations: 0 }).ok, false);
});
~~~

- [x] **Step 2: Run RED**

Run: node --experimental-strip-types src/lib/research-missions.test.ts

Expected: FAIL with ERR_MODULE_NOT_FOUND.

- [x] **Step 3: Implement the shared types and lifecycle helpers**

~~~ts
export const RESEARCH_MISSION_MODES = ["brief", "sweep", "paper", "autoresearch"] as const;
export type ResearchMissionMode = (typeof RESEARCH_MISSION_MODES)[number];
export type ResearchMissionStatus =
  | "queued" | "planning" | "running" | "checkpoint" | "paused"
  | "completed" | "failed" | "cancelled" | "archived";
export type ResearchMissionAction =
  | "retry" | "continue" | "refine" | "finish" | "pause" | "resume" | "cancel" | "archive";

export type ResearchBounds = {
  wallClockMinutes: number;
  maxIterations: number;
  sourceTarget: number;
  maxSpendUsd?: number;
  checkpointEvery: number;
  stopWhenCostUnavailable: boolean;
};

export function allowedResearchActions(
  mission: Pick<ResearchMission, "status">,
): ResearchMissionAction[] {
  if (["queued", "planning", "running"].includes(mission.status)) return ["cancel"];
  if (mission.status === "checkpoint") return ["continue", "refine", "finish", "cancel", "archive"];
  if (mission.status === "paused") return ["resume", "refine", "finish", "cancel", "archive"];
  if (mission.status === "failed") return ["retry", "finish", "archive"];
  if (mission.status === "completed" || mission.status === "cancelled") return ["continue", "archive"];
  return [];
}
~~~

- [x] **Step 4: Implement deterministic Auto routing**

~~~ts
const ROUTES = [
  { mode: "autoresearch", reason: "iterative experiment or continuation request", pattern: /\b(autoresearch|experiment|optimi[sz]e|until|keep researching|loop)\b/i },
  { mode: "paper", reason: "formal paper or literature-review request", pattern: /\b(paper|whitepaper|literature review|systematic review)\b/i },
  { mode: "sweep", reason: "broad landscape or exhaustive-source request", pattern: /\b(landscape|exhaustive|market map|survey|trend map|all alternatives)\b/i },
  { mode: "brief", reason: "comparison or recommendation request", pattern: /\b(compare|comparison|recommend|summary|brief|question)\b/i },
] as const;

export function inferResearchMissionMode(intent: string) {
  return ROUTES.find((route) => route.pattern.test(intent)) ?? {
    mode: "brief" as const,
    reason: "safe default for an ambiguous request",
  };
}
~~~

- [x] **Step 5: Wire and verify GREEN**

Add src/lib/research-missions.test.ts after role-surfaces.test.ts in scripts/run-tests.mjs.

Run: node --experimental-strip-types src/lib/research-missions.test.ts

Expected: four passing subtests.

Run: pnpm check:tests-wired

Expected: exit 0.

- [ ] **Step 6: Commit after authorization**

~~~bash
git add src/lib/research-missions.ts src/lib/research-mission-routing.ts src/lib/research-missions.test.ts scripts/run-tests.mjs
git commit -m "feat(research): define bounded mission model and routing (cave-iob1)"
~~~

### Task 2: Add the safe mission workspace store

**Files:**
- Create: src/lib/server/research-mission-store.ts
- Create: src/lib/server/research-mission-store.test.ts
- Modify: scripts/run-tests.mjs:139-151

- [x] **Step 1: Write failing path, persistence, and concurrency tests**

~~~ts
test("mission ids cannot escape the root", async () => {
  process.env.COVEN_RESEARCH_MISSIONS_DIR = await mkdtemp(path.join(os.tmpdir(), "research-store-"));
  await assert.rejects(
    () => createResearchMissionWorkspace({ ...MISSION, id: "../escape" }),
    /invalid mission id/,
  );
});

test("concurrent saves leave one complete JSON record", async () => {
  const created = await createResearchMissionWorkspace(MISSION);
  await Promise.all([
    saveResearchMission({ ...created, title: "first" }),
    saveResearchMission({ ...created, title: "second" }),
  ]);
  const loaded = await loadResearchMission(created.id);
  assert.ok(loaded?.title === "first" || loaded?.title === "second");
});

test("artifact reads reject symlinks", async () => {
  const mission = await createResearchMissionWorkspace({ ...MISSION, id: "symlink-case" });
  await symlink("/etc/hosts", missionArtifactPath(mission.id, "primary.md"));
  await assert.rejects(
    () => readValidatedMissionFile(mission.id, "artifacts/primary.md"),
    /symlink/,
  );
});
~~~

- [x] **Step 2: Run RED**

Run: node --experimental-strip-types src/lib/server/research-mission-store.test.ts

Expected: FAIL with missing module.

- [x] **Step 3: Implement strict ids, atomic writes, and the write lock**

~~~ts
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function missionsRoot(): string {
  return process.env.COVEN_RESEARCH_MISSIONS_DIR?.trim()
    || path.join(caveHome(), "research-missions");
}

function missionDir(id: string): string {
  if (!ID_RE.test(id)) throw new Error("invalid mission id");
  return path.join(missionsRoot(), id);
}

declare global {
  var __researchMissionWriteChain: Promise<unknown> | undefined;
}

function withMissionLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = globalThis.__researchMissionWriteChain ?? Promise.resolve();
  const next = previous.then(fn, fn);
  globalThis.__researchMissionWriteChain = next.catch(() => undefined);
  return next;
}

export async function saveResearchMission(mission: ResearchMission): Promise<void> {
  await withMissionLock(async () => {
    await mkdir(missionDir(mission.id), { recursive: true });
    await writeJsonAtomic(path.join(missionDir(mission.id), "mission.json"), mission);
  });
}
~~~

Initialize mission.json, research-state.yaml, findings.md, research-log.md,
sources.json, and artifacts/. Use lstat plus realpath containment for reads.
Reject symlinks and files over exported caps. Derive the list from validated
mission directories; do not create a second index.

- [x] **Step 4: Wire and verify GREEN**

Add the test beside flow-executor.test.ts in scripts/run-tests.mjs.

Run: node --experimental-strip-types src/lib/server/research-mission-store.test.ts

Expected: all path, round-trip, concurrency, cap, and symlink cases pass.

- [ ] **Step 5: Commit after authorization**

~~~bash
git add src/lib/server/research-mission-store.ts src/lib/server/research-mission-store.test.ts scripts/run-tests.mjs
git commit -m "feat(research): persist safe mission workspaces (cave-iob1)"
~~~

### Task 3: Define artifact, source, control-marker, and provenance contracts

**Files:**
- Create: src/lib/research-artifact-contract.ts
- Create: src/lib/research-artifact-contract.test.ts
- Modify: scripts/run-tests.mjs:34-151

- [x] **Step 1: Write failing contract tests**

~~~ts
test("valid control output parses", () => {
  const transcript = [
    "noise",
    "@@research-control",
    "{\"decision\":\"complete\",\"reason\":\"Enough evidence\",\"confidence\":0.9}",
    "@@research-artifacts-written",
  ].join("\n");
  assert.deepEqual(parseResearchControl(transcript), {
    decision: "complete",
    reason: "Enough evidence",
    confidence: 0.9,
  });
});

test("malformed control pauses", () => {
  assert.deepEqual(parseResearchControl("@@research-control\nnot-json"), {
    decision: "checkpoint",
    reason: "Missing or malformed research control output",
    confidence: null,
  });
});

test("sources require a safe URL or local path", () => {
  assert.equal(normalizeResearchSource({ id: "s1", title: "Paper" }).ok, false);
  assert.equal(
    normalizeResearchSource({ id: "s1", title: "Paper", url: "https://example.com" }).ok,
    true,
  );
});

test("presentation artifacts accept Markdown or self-contained HTML only", () => {
  assert.equal(normalizeResearchArtifact({ kind: "presentation", path: "artifacts/slides.md" }).ok, true);
  assert.equal(normalizeResearchArtifact({ kind: "presentation", path: "artifacts/slides.html" }).ok, true);
  assert.equal(normalizeResearchArtifact({ kind: "presentation", path: "artifacts/slides.js" }).ok, false);
});

test("provenance names mission, iteration, run, and session", () => {
  const header = researchProvenanceHeader(PROVENANCE);
  assert.match(header, /mission: cave-research-1/);
  assert.match(header, /session: session-1/);
});
~~~

- [x] **Step 2: Run RED**

Run: node --experimental-strip-types src/lib/research-artifact-contract.test.ts

Expected: FAIL with missing module.

- [x] **Step 3: Implement bounded marker parsing and Knowledge payloads**

~~~ts
export const RESEARCH_CONTROL_MARKER = "@@research-control";
export const RESEARCH_ARTIFACTS_WRITTEN_MARKER = "@@research-artifacts-written";

export function parseResearchControl(transcript: string): ResearchControl {
  const marker = transcript.lastIndexOf(RESEARCH_CONTROL_MARKER + "\n");
  if (marker < 0) return MALFORMED_CONTROL;
  const after = transcript.slice(marker + RESEARCH_CONTROL_MARKER.length + 1);
  const line = after.split(/\r?\n/, 1)[0];
  try {
    const value = JSON.parse(line) as Partial<ResearchControl>;
    if (!["continue", "checkpoint", "complete"].includes(value.decision ?? "")) {
      return MALFORMED_CONTROL;
    }
    return {
      decision: value.decision as ResearchControl["decision"],
      reason: cleanText(value.reason, 500) || "No reason supplied",
      confidence: typeof value.confidence === "number"
        ? Math.max(0, Math.min(1, value.confidence))
        : null,
    };
  } catch {
    return MALFORMED_CONTROL;
  }
}

export function researchKnowledgeEntry(args: PublishArtifactArgs): KnowledgeEntry {
  return {
    id: ["research", args.mission.id, args.artifact.key].join("-"),
    title: args.artifact.title,
    tags: ["research", "mission:" + args.mission.id, args.mission.mode, args.artifact.kind],
    scope: [args.mission.familiarId],
    enabled: true,
    body: researchProvenanceHeader(args.provenance) + "\n\n" + args.markdown.trim() + "\n",
  };
}
~~~

- [x] **Step 4: Verify GREEN and wire**

Run: node --experimental-strip-types src/lib/research-artifact-contract.test.ts

Expected: marker, malformed fallback, source validation, size cap, and
provenance tests pass.

Add the test to scripts/run-tests.mjs and run pnpm check:tests-wired.

- [ ] **Step 5: Commit after authorization**

~~~bash
git add src/lib/research-artifact-contract.ts src/lib/research-artifact-contract.test.ts scripts/run-tests.mjs
git commit -m "feat(research): validate mission artifacts and provenance (cave-iob1)"
~~~

### Task 4: Build and run one bounded mission Flow

**Files:**
- Create: src/lib/research-mission-flow.ts
- Create: src/lib/research-mission-flow.test.ts
- Create: src/lib/server/research-mission-runner.ts
- Create: src/lib/server/research-mission-runner.test.ts
- Modify: scripts/run-tests.mjs:125-153

- [x] **Step 1: Write failing Flow and runner tests**

~~~ts
test("Flow order is scope, gather, challenge, synthesize, control, publish", () => {
  const flow = buildResearchMissionFlow(MISSION, 1);
  assert.deepEqual(
    flowExecutionOrder(flow),
    ["trigger", "scope", "gather", "challenge", "synthesize", "control", "publish"],
  );
});

test("paper mode requires eight distinct sources and Markdown", () => {
  const flow = buildResearchMissionFlow({ ...MISSION, mode: "paper" }, 1);
  const prompt = compileFlowPrompt(flow);
  assert.match(prompt, /at least 8 distinct source materials/);
  assert.match(prompt, /artifacts\/primary\.md/);
});

test("create/start persists before launch and records the real session", async () => {
  const calls: string[] = [];
  const runner = makeResearchMissionRunner({
    ...FAKE_DEPS,
    saveMission: async () => { calls.push("save"); },
    startFlow: async () => {
      calls.push("start");
      return { ok: true, run: RUN, sessionId: "s1", executor: "session" };
    },
  });
  const mission = await runner.createAndStart(INPUT);
  assert.deepEqual(calls, ["save", "start", "save"]);
  assert.equal(mission.iterations[0].sessionId, "s1");
  assert.equal(mission.status, "running");
});

test("launch failure remains retryable", async () => {
  const runner = makeResearchMissionRunner({
    ...FAKE_DEPS,
    startFlow: async () => ({ ok: false, error: "daemon offline", unavailable: true }),
  });
  const mission = await runner.createAndStart(INPUT);
  assert.equal(mission.status, "failed");
  assert.ok(allowedResearchActions(mission).includes("retry"));
});
~~~

- [x] **Step 2: Run RED**

Run: node --experimental-strip-types src/lib/research-mission-flow.test.ts

Expected: FAIL with missing module.

Run: node --experimental-strip-types src/lib/server/research-mission-runner.test.ts

Expected: FAIL with missing module.

- [x] **Step 3: Implement the Flow builder**

~~~ts
export function buildResearchMissionFlow(
  mission: ResearchMission,
  iteration: number,
): FlowDoc {
  const workspace = researchMissionWorkspacePath(mission.id);
  const context = [
    "Mission: " + mission.id,
    "Iteration: " + iteration + " of " + mission.bounds.maxIterations,
    "Intent: " + mission.intent,
    "Read existing mission state before acting.",
    "Write only under: " + workspace,
  ].join("\n");

  const ids = ["trigger", "scope", "gather", "challenge", "synthesize", "control", "publish"];
  return {
    version: 1,
    id: ["research", mission.id, "iteration", String(iteration)].join("-"),
    name: mission.title + " · iteration " + iteration,
    nodes: [
      node("trigger", "trigger.manual", "Start bounded iteration", {}),
      familiarNode("scope", "Scope question", context + "\nDefine questions and evidence standard."),
      familiarNode("gather", "Gather sources", context + "\nGather primary and local sources; update sources.json."),
      familiarNode("challenge", "Challenge claims", context + "\nTry to refute weak or conflicting claims."),
      familiarNode("synthesize", "Synthesize artifacts", context + "\nUpdate findings.md and artifacts/primary.md."),
      familiarNode("control", "Choose next state", controlPrompt(mission, iteration)),
      familiarNode("publish", "Publish working files", publishPrompt(workspace)),
    ],
    edges: chainEdges(ids),
  };
}
~~~

Every node prompt repeats the approved workspace and stop rules. The publish
prompt writes valid files first, then prints the exact bare lines
@@research-control, one JSON line, and @@research-artifacts-written.

- [x] **Step 4: Implement a dependency-injected runner**

~~~ts
export type ResearchMissionRunnerDeps = {
  saveMission(mission: ResearchMission): Promise<void>;
  startFlow(flow: FlowDoc, options: { projectRoot: string | null }): Promise<StartFlowResult>;
  loadConversation(sessionId: string): Promise<CaveConversation | null>;
  readMissionFile(id: string, relativePath: string): Promise<string | null>;
  readSources(id: string): Promise<ResearchSourceRef[]>;
  publishKnowledge(entry: KnowledgeEntry): Promise<KnowledgeEntry>;
  now(): Date;
  randomId(): string;
};

export function makeResearchMissionRunner(deps: ResearchMissionRunnerDeps) {
  return {
    async createAndStart(input: CreateResearchMissionInput) {
      let mission = createMissionRecord(input, deps.randomId(), deps.now());
      await createResearchMissionWorkspace(mission);
      await deps.saveMission(mission);
      const flow = buildResearchMissionFlow(mission, 1);
      const result = await deps.startFlow(flow, {
        projectRoot: mission.projectRoot ?? researchMissionWorkspacePath(mission.id),
      });
      mission = applyStartResult(mission, result, deps.now());
      await deps.saveMission(mission);
      return mission;
    },
    reconcile: (mission: ResearchMission) => reconcileResearchMission(mission, deps),
  };
}
~~~

Production dependencies call startFlowSession, loadConversation,
writeKnowledgeEntry, and mission-store helpers directly. Reconciliation uses
persisted run/session evidence, validates files, and publishes idempotently.

- [x] **Step 5: Wire and verify GREEN**

Run:

~~~bash
node --experimental-strip-types src/lib/research-mission-flow.test.ts
node --experimental-strip-types src/lib/server/research-mission-runner.test.ts
node --experimental-strip-types src/lib/server/flow-executor.test.ts
~~~

Expected: all commands exit 0.

- [ ] **Step 6: Commit after authorization**

~~~bash
git add src/lib/research-mission-flow.ts src/lib/research-mission-flow.test.ts src/lib/server/research-mission-runner.ts src/lib/server/research-mission-runner.test.ts scripts/run-tests.mjs
git commit -m "feat(research): run bounded mission flows (cave-iob1)"
~~~

### Task 5: Expose APIs and build the mission-first Research Desk

**Files:**
- Create: src/app/api/research/missions/route.ts
- Create: src/app/api/research/missions/[id]/route.ts
- Create: src/app/api/research/missions/route.test.ts
- Create: src/lib/research-mission-client.ts
- Create: src/lib/research-mission-client.test.ts
- Create: src/components/role-surfaces/research-mission-composer.tsx
- Create: src/components/role-surfaces/research-mission-list.tsx
- Create: src/components/role-surfaces/research-mission-detail.tsx
- Create: src/components/role-surfaces/use-research-missions.ts
- Create: src/components/role-surfaces/researcher-surface.test.ts
- Modify: src/components/role-surfaces/researcher-surface.tsx:1-380
- Modify: src/components/role-surfaces/register.tsx:60-125
- Modify: src/app/api/api-contracts.test.ts:15-180
- Modify: src/app/globals.css:14680-15285
- Modify: scripts/run-tests.mjs

- [x] **Step 1: Write failing API and surface contract tests**

~~~ts
test("create route is local-only and guarded", () => {
  assert.match(routeSource, /rejectNonLocalRequest\(req\)/);
  assert.match(routeSource, /readJsonBody<CreateResearchMissionInput>/);
  assert.match(routeSource, /createAndStart/);
});

assert.match(surfaceSource, /useResearchMissions/);
assert.match(surfaceSource, /ResearchMissionComposer/);
assert.match(surfaceSource, /ResearchMissionList/);
assert.match(surfaceSource, /ResearchMissionDetail/);
assert.doesNotMatch(surfaceSource, /RESEARCHER_INITIAL_STATE/);
assert.match(composerSource, /What should we investigate\?/);
assert.match(composerSource, /Start research/);
assert.match(detailSource, /aria-label="Research progress"/);
assert.match(cssSource, /container-type:\s*inline-size/);
~~~

- [x] **Step 2: Run RED**

Run: node --experimental-strip-types src/app/api/research/missions/route.test.ts

Expected: FAIL because the route is absent.

Run: node --experimental-strip-types src/components/role-surfaces/researcher-surface.test.ts

Expected: FAIL because mission UI modules are absent.

- [x] **Step 3: Implement guarded list/create and detail routes**

~~~ts
export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<CreateResearchMissionInput>(req, MAX_SESSION_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  const validated = validateCreateResearchMissionInput(parsed.body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  }
  const mission = await researchMissionRunner().createAndStart(validated.value);
  return NextResponse.json({ ok: true, mission });
}

export async function GET(req: Request) {
  const familiarId = new URL(req.url).searchParams.get("familiarId")?.trim() ?? "";
  if (!familiarId) {
    return NextResponse.json({ ok: false, error: "familiarId required" }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    missions: await listAndReconcileResearchMissions(familiarId),
  });
}
~~~

Register:

~~~ts
{ route: "/research/missions/[id]", methods: ["GET"], kind: "json", pathGuard: true },
{ route: "/research/missions", methods: ["GET", "POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true, pathGuard: true },
~~~

- [x] **Step 4: Implement the abortable client hook**

~~~ts
export function useResearchMissions(familiarId: string) {
  const [state, setState] = useState(initialResearchMissionViewState);
  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await listResearchMissions(familiarId, signal);
    if (signal?.aborted) return;
    setState((current) => selectStableMission(current, result.missions ?? []));
  }, [familiarId]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  usePausablePoll(
    () => load(),
    state.missions.some(isActiveResearchMission) ? 2_000 : 15_000,
  );
  useRefreshOnFocus(load);
  return { ...state, load };
}
~~~

- [x] **Step 5: Implement composer, list, detail, and surface composition**

~~~tsx
export function ResearchMissionComposer(props: Props) {
  const [intent, setIntent] = useState("");
  const [mode, setMode] = useState<"auto" | ResearchMissionMode>("auto");
  const inferred = inferResearchMissionMode(intent);
  const effectiveMode = mode === "auto" ? inferred.mode : mode;
  const plan = defaultResearchPlan(effectiveMode);
  return (
    <form onSubmit={start} className="research-mission-composer">
      <label htmlFor="research-intent">What should we investigate?</label>
      <textarea
        id="research-intent"
        value={intent}
        onChange={(event) => setIntent(event.target.value)}
      />
      <ResearchPlanChips
        mode={effectiveMode}
        reason={mode === "auto" ? inferred.reason : "Selected manually"}
        plan={plan}
      />
      <ResearchBoundsDisclosure value={bounds} onChange={setBounds} />
      <Button
        type="submit"
        disabled={!intent.trim() || !props.daemonRunning || submitting}
      >
        Start research
      </Button>
    </form>
  );
}
~~~

ResearcherSurface becomes a container-query composition of mission list,
composer/detail, and artifacts/sources rail. Keep browser opening and session
navigation through RoleSurfaceContext. Remove local-only objectives, notes,
hypotheses, and evidence after the mission API covers them.

- [x] **Step 6: Verify Slice 1**

Run:

~~~bash
node --experimental-strip-types src/app/api/research/missions/route.test.ts
node --experimental-strip-types src/lib/research-mission-client.test.ts
node --experimental-strip-types src/components/role-surfaces/researcher-surface.test.ts
node --experimental-strip-types src/components/role-surface-shell.test.ts
node --experimental-strip-types src/app/api/api-contracts.test.ts
pnpm check:tests-wired
pnpm typecheck
pnpm test:app
~~~

Expected: every command exits 0 and every new test is wired.

- [ ] **Step 7: Verify the native one-shot path**

Run: bash scripts/dev-app.sh

In the Tauri window, Auto-route and start a Brief, observe real phases, open the
published artifact in Knowledge/Grimoire, restart the app, and confirm mission
and artifact recovery.

- [ ] **Step 8: Commit after authorization**

~~~bash
git add src/app/api/research src/lib/research-mission-client.ts src/lib/research-mission-client.test.ts src/components/role-surfaces src/app/api/api-contracts.test.ts src/app/globals.css scripts/run-tests.mjs
git commit -m "feat(research): ship the one-shot mission factory (cave-iob1)"
~~~

## Slice 2: lifecycle, checkpoints, cost, and evidence

### Task 6: Add locked lifecycle actions and evidence management

**Files:**
- Create: src/app/api/research/missions/[id]/actions/route.ts
- Create: src/app/api/research/missions/[id]/actions/route.test.ts
- Create: src/components/role-surfaces/research-evidence-ledger.tsx
- Create: src/components/role-surfaces/research-evidence-ledger.test.ts
- Modify: src/lib/server/research-mission-runner.ts
- Modify: src/lib/server/research-mission-runner.test.ts
- Modify: src/lib/research-missions.ts
- Modify: src/lib/research-mission-client.ts
- Modify: src/components/role-surfaces/research-mission-detail.tsx
- Modify: src/app/api/api-contracts.test.ts
- Modify: src/app/globals.css
- Modify: scripts/run-tests.mjs

- [x] **Step 1: Write failing lifecycle and evidence tests**

~~~ts
test("two Continue calls create one iteration", async () => {
  const [a, b] = await Promise.all([
    runner.act(MISSION.id, { action: "continue" }),
    runner.act(MISSION.id, { action: "continue" }),
  ]);
  assert.equal(a.iterations.length, 2);
  assert.equal(b.iterations.length, 2);
  assert.equal(START_CALLS.length, 1);
});

test("cost-unavailable policy pauses before another iteration", async () => {
  const result = await runner.act(MISSION.id, { action: "continue" });
  assert.equal(result.status, "paused");
  assert.match(result.lastError ?? "", /Cost unavailable/);
});

test("cancel kills the active session and preserves artifacts", async () => {
  const result = await runner.act(RUNNING.id, { action: "cancel" });
  assert.deepEqual(KILL_CALLS, [RUNNING.iterations[0].sessionId]);
  assert.equal(result.status, "cancelled");
  assert.equal(result.artifacts.length, RUNNING.artifacts.length);
});

test("manual sources normalize and dedupe", async () => {
  await runner.act(MISSION.id, {
    action: "attach-source",
    source: { title: "Spec", url: "https://example.com/spec", status: "candidate" },
  });
  const result = await runner.act(MISSION.id, {
    action: "attach-source",
    source: { title: "Duplicate", url: "https://example.com/spec", status: "used" },
  });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].status, "used");
});

test("evidence can be revised and artifacts can be rejected without deletion", async () => {
  const revised = await runner.act(MISSION.id, {
    action: "update-source",
    sourceId: "source-1",
    patch: { status: "conflicting", note: "Method does not match the target cohort" },
  });
  assert.equal(revised.sources[0].status, "conflicting");
  const rejected = await runner.act(MISSION.id, {
    action: "reject-artifact",
    artifactKey: "brief",
    reason: "Needs a narrower comparison set",
  });
  assert.equal(rejected.artifacts[0].status, "rejected");
  assert.match(rejected.artifacts[0].rejectionReason ?? "", /narrower comparison/);
});

test("refine updates direction before creating one next iteration", async () => {
  const result = await runner.act(MISSION.id, {
    action: "refine",
    direction: "Prioritize primary sources published since 2024",
  });
  assert.equal(result.direction, "Prioritize primary sources published since 2024");
  assert.equal(result.iterations.length, 2);
});
~~~

- [x] **Step 2: Run RED**

Run: node --experimental-strip-types src/lib/server/research-mission-runner.test.ts

Expected: FAIL because act is absent.

- [x] **Step 3: Implement actions inside a per-mission lock**

~~~ts
type ResearchMissionActionInput =
  | { action: ResearchMissionAction; direction?: string }
  | { action: "attach-source"; source: ResearchSourceDraft }
  | { action: "update-source"; sourceId: string; patch: ResearchSourcePatch }
  | { action: "reject-artifact"; artifactKey: string; reason: string };

async function act(id: string, input: ResearchMissionActionInput) {
  return withResearchMissionLock(id, async () => {
    let mission = await requireResearchMission(id);
    mission = await reconcileResearchMission(mission, deps);
    if (input.action === "attach-source") {
      return saveMission({
        ...mission,
        sources: mergeResearchSource(mission.sources, normalizeAttachedSource(input.source)),
      });
    }
    if (input.action === "update-source") {
      return saveMission(updateResearchSource(mission, input.sourceId, input.patch));
    }
    if (input.action === "reject-artifact") {
      return saveMission(rejectResearchArtifact(mission, input.artifactKey, input.reason));
    }
    if (!allowedResearchActions(mission).includes(input.action)) return mission;
    if (input.action === "continue" || input.action === "retry" || input.action === "refine") {
      if (input.action === "refine") mission = updateResearchDirection(mission, input.direction);
      return startNextResearchIteration(mission, deps);
    }
    if (input.action === "finish") return finishResearchMission(mission, deps.now());
    if (input.action === "cancel") return cancelResearchMission(mission, deps);
    if (input.action === "archive") return archiveResearchMission(mission, deps.now());
    return setResearchMissionPaused(mission, input.action === "pause");
  });
}
~~~

Aggregate turn costUsd and normalized usage from stored conversations. Enforce
iteration, wall-clock, spend, and cost-unavailable policies before starting.
Normalize source URLs with existing safety helpers and dedupe by URL/local path.
Revision and rejection are append-preserving state changes: keep the original
source/artifact file and record status, reason, and timestamp in the mission.

- [x] **Step 4: Implement guarded action route and evidence UI**

Register:

~~~ts
{ route: "/research/missions/[id]/actions", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true, pathGuard: true },
~~~

Render candidate, used, conflicting, and rejected as a status dot plus visible
word. Open URLs through context.openUrl. Render artifacts/sources as shared Tabs
on narrow panes and the research log as an ordered iteration drawer.

- [x] **Step 5: Verify GREEN**

Run:

~~~bash
node --experimental-strip-types src/lib/server/research-mission-runner.test.ts
node --experimental-strip-types src/app/api/research/missions/[id]/actions/route.test.ts
node --experimental-strip-types src/components/role-surfaces/research-evidence-ledger.test.ts
node --experimental-strip-types src/components/role-surfaces/researcher-surface.test.ts
pnpm typecheck
~~~

Expected: all commands exit 0.

- [ ] **Step 6: Commit after authorization**

~~~bash
git add src/lib/research-missions.ts src/lib/server/research-mission-runner.ts src/lib/server/research-mission-runner.test.ts src/lib/research-mission-client.ts src/app/api/research/missions/[id]/actions src/components/role-surfaces src/app/api/api-contracts.test.ts src/app/globals.css scripts/run-tests.mjs
git commit -m "feat(research): add lifecycle and evidence control (cave-iob1)"
~~~

## Slice 3: autoresearch and linked Automations

### Task 7: Create linked Automations and reconcile bounded ticks

**Files:**
- Create: src/app/api/research/missions/[id]/schedule/route.ts
- Create: src/app/api/research/missions/[id]/schedule/route.test.ts
- Modify: src/lib/server/research-mission-runner.ts
- Modify: src/lib/server/research-mission-runner.test.ts
- Modify: src/lib/research-artifact-contract.ts
- Modify: src/lib/research-mission-client.ts
- Modify: src/components/role-surfaces/research-mission-detail.tsx
- Modify: src/app/api/api-contracts.test.ts
- Modify: scripts/run-tests.mjs

- [x] **Step 1: Write failing schedule and loop tests**

~~~ts
test("schedule creates a paused tagged one-iteration Automation", async () => {
  const mission = await runner.schedule(MISSION.id, {
    rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
  });
  assert.deepEqual(CREATED_AUTOMATIONS[0].tags, [
    "research-mission",
    "research-mission:" + MISSION.id,
  ]);
  assert.deepEqual(CREATED_AUTOMATIONS[0].cwds, [
    researchMissionWorkspacePath(MISSION.id),
  ]);
  assert.match(CREATED_AUTOMATIONS[0].prompt, /exactly one bounded research iteration/i);
  assert.equal(mission.automationId, CREATED_AUTOMATIONS[0].id);
  assert.equal(UPDATED_AUTOMATIONS[0].status, "PAUSED");
});

test("a succeeded tick without a checkpoint pauses honestly", async () => {
  const result = await runner.reconcileAutomationTick(AUTORESEARCH, AUTOMATION_RUN);
  assert.equal(result.status, "paused");
  assert.equal(
    result.lastError,
    "Automation ran without a valid research checkpoint",
  );
});

test("loop bounds disable future ticks", async () => {
  const result = await runner.reconcileAutomationTick(AT_MAX_ITERATIONS, VALID_RUN);
  assert.equal(result.status, "completed");
  assert.deepEqual(UPDATED_AUTOMATIONS.at(-1), {
    id: AT_MAX_ITERATIONS.automationId,
    status: "PAUSED",
  });
});

test("linked automation controls pause, resume, and run now", async () => {
  await runner.controlSchedule(AUTORESEARCH.id, { action: "resume" });
  await runner.controlSchedule(AUTORESEARCH.id, { action: "run-now" });
  await runner.controlSchedule(AUTORESEARCH.id, { action: "pause" });
  assert.deepEqual(AUTOMATION_CONTROLS.map((item) => item.action), [
    "resume",
    "run-now",
    "pause",
  ]);
});
~~~

- [x] **Step 2: Run RED**

Run: node --experimental-strip-types src/lib/server/research-mission-runner.test.ts

Expected: FAIL because schedule and tick reconciliation are absent.

- [x] **Step 3: Create a standard paused Automation without schema changes**

~~~ts
async function schedule(id: string, input: ScheduleResearchMissionInput) {
  return withResearchMissionLock(id, async () => {
    const mission = await requireResearchMission(id);
    const automation = await deps.createAutomation({
      name: "Research: " + mission.title,
      rrule: input.rrule,
      prompt: buildResearchAutomationPrompt(mission),
      cwds: [researchMissionWorkspacePath(mission.id)],
      tags: ["research-mission", "research-mission:" + mission.id],
      familiars: [mission.familiarId],
      model: input.model ?? "",
      reasoningEffort: input.reasoningEffort ?? "high",
      executionEnvironment: "local",
      skillPath: input.skillPath ?? null,
    });
    await deps.updateAutomation(automation.id, { status: "PAUSED" });
    return saveMission({
      ...mission,
      automationId: automation.id,
      updatedAt: deps.now().toISOString(),
    });
  });
}
~~~

Use the optional autoresearch skill only when installed. Otherwise the complete
first-party continuation prompt carries the workspace files, exact markers,
one-iteration limit, and stop rules.

- [x] **Step 4: Reconcile Automation runs by file checkpoint**

~~~ts
async function reconcileAutomationTick(
  mission: ResearchMission,
  run: AutomationRunRecord,
) {
  if (mission.iterations.some((item) => item.automationRunId === run.id)) return mission;
  if (run.status === "running" || run.status === "queued") {
    return markAutomationIterationActive(mission, run);
  }
  if (run.status === "failed") return pauseAfterAutomationFailure(mission, run);
  const checkpoint = await deps.readResearchCheckpoint(mission.id);
  if (!checkpoint.changed || checkpoint.controlMalformed) {
    return pauseMission(
      mission,
      "Automation ran without a valid research checkpoint",
      deps.now(),
    );
  }
  return enforceResearchLoopStop(
    appendAutomationIteration(mission, run, checkpoint),
    deps,
  );
}
~~~

Fingerprint research-state.yaml, findings.md, sources.json, and artifact mtimes
before each tick. A succeeded run counts only when the fingerprint changes and
the control marker is valid. Dedupe by automationRunId.

- [x] **Step 5: Implement the guarded schedule route and UI**

Register:

~~~ts
{ route: "/research/missions/[id]/schedule", methods: ["POST"], kind: "json", readsJson: true, invalidJson: "guarded", localOriginGuard: true, pathGuard: true },
~~~

Show iteration used/max, elapsed used/limit, reported cost or Cost unavailable,
schedule, last run, and exact stop reason. The schedule review is paused until
the user activates it. Wire Pause, Resume, and Run now through the existing
Automation client/control surface; do not add a research-only automation schema.

- [x] **Step 6: Verify GREEN**

Run:

~~~bash
node --experimental-strip-types src/lib/server/research-mission-runner.test.ts
node --experimental-strip-types src/app/api/research/missions/[id]/schedule/route.test.ts
node --experimental-strip-types src/components/role-surfaces/researcher-surface.test.ts
node --experimental-strip-types src/app/api/api-contracts.test.ts
pnpm typecheck
~~~

Expected: schedule, pause review, dedupe, invalid checkpoint, failure,
max-iterations, elapsed-time, spend, cost-unavailable, and complete-decision
cases pass.

- [ ] **Step 7: Commit after authorization**

~~~bash
git add src/lib/server/research-mission-runner.ts src/lib/server/research-mission-runner.test.ts src/lib/research-artifact-contract.ts src/lib/research-mission-client.ts src/app/api/research/missions/[id]/schedule src/components/role-surfaces/research-mission-detail.tsx src/app/api/api-contracts.test.ts scripts/run-tests.mjs
git commit -m "feat(research): add bounded autoresearch Automations (cave-iob1)"
~~~

### Task 8: Accessibility, responsive polish, full audit, and native verification

**Files:**
- Modify: src/components/role-surfaces/research-mission-composer.tsx
- Modify: src/components/role-surfaces/research-mission-list.tsx
- Modify: src/components/role-surfaces/research-mission-detail.tsx
- Modify: src/components/role-surfaces/researcher-surface.test.ts
- Modify: src/app/globals.css
- Modify: docs/role-surfaces.md:60-75
- Modify: docs/specs/2026-07-12-research-mission-desk-plan.md

- [x] **Step 1: Add failing accessibility and container assertions**

~~~ts
assert.match(listSource, /aria-current=\{selected/);
assert.match(detailSource, /<ol[^>]*aria-label="Research progress"/);
assert.match(composerSource, /aria-describedby/);
assert.match(detailSource, /useAnnouncer/);
assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(cssSource, /@container research-desk \(max-width: 760px\)/);
~~~

- [x] **Step 2: Run RED**

Run: node --experimental-strip-types src/components/role-surfaces/researcher-surface.test.ts

Expected: FAIL on at least one new assertion.

- [x] **Step 3: Implement final accessibility and narrow-pane behavior**

Use shared Tabs, Button, ErrorState, skeleton, and announcer primitives. Every
status has a dot and word. Selected missions use aria-current. Progress is an
ordered list. Forms associate errors through aria-describedby. Primary actions
never depend on hover. At a 760px container width, side rails become a mission
selector and Artifacts/Sources tabs. Reduced motion removes phase pulses.

- [x] **Step 4: Run full automated gates**

Run:

~~~bash
node --experimental-strip-types src/components/role-surfaces/researcher-surface.test.ts
node --experimental-strip-types src/components/role-surface-shell.test.ts
node --experimental-strip-types src/app/api/api-contracts.test.ts
pnpm check:tests-wired
pnpm typecheck
pnpm test:app
~~~

Expected: every command exits 0.

- [ ] **Step 5: Verify all product states in the native app**

Run: bash scripts/dev-app.sh and keep it in the foreground.

Verify:

1. Brief, Sweep, Paper, and Autoresearch routing and overrides.
2. Real session launch, phases, cancel, retry, and restart recovery.
3. Artifact publication and Knowledge/Grimoire navigation.
4. Source candidate, used, conflicting, rejected, and manual attachment states.
5. Checkpoint Continue and Finish now.
6. Two-iteration autoresearch with paused linked Automation, Run now, valid checkpoint, and final disable.
7. Iteration, wall-clock, spend, and cost-unavailable stops.
8. Daemon offline, malformed artifact, invalid checkpoint, Automation unavailable, and Travel queued states.
9. Keyboard-only operation, announcements, reduced motion, and narrow split-pane layout.

Capture native screenshots for empty, running, checkpoint, completed/artifacts,
and autoresearch states.

- [x] **Step 6: Run the requirement-level completion audit**

Re-read docs/specs/2026-07-12-research-mission-desk-design.md:528-548. Record
the exact test, file, API response, run/session evidence, artifact, or screenshot
for every acceptance bullet in cave-iob1. Missing or indirect proof keeps the
bead open.

- [x] **Step 7: Update role-surface documentation**

~~~md
- **Research Desk** (researcher-desk, role researcher) — mission-first research intake, explainable Brief/Sweep/Paper/Autoresearch routing, real Flow progress, provenance-rich Knowledge artifacts, structured sources, checkpoints, and bounded linked Automations.
~~~

- [ ] **Step 8: Commit after authorization**

~~~bash
git add src/components/role-surfaces src/app/globals.css docs/role-surfaces.md docs/specs/2026-07-12-research-mission-desk-plan.md
git commit -m "feat(research): finish the bounded research factory (cave-iob1)"
~~~

- [x] **Step 9: Prepare the PR-shaped handoff**

Run:

~~~bash
git status --short
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
bd show cave-iob1
~~~

Expected: only Research Mission scope is present, all evidence is recorded, and
no unrelated canonical-checkout changes were absorbed.
