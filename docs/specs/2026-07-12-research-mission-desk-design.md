# Research Mission Desk Design

**Status:** Approved direction
**Date:** 2026-07-12
**Bead:** `cave-iob1`

## Summary

Replace the Research Desk's manual collection of objectives, scratch notes, and
evidence with a mission-first control plane. A user describes what they need in
plain language; the Desk infers a bounded research mode, shows the important
assumptions, starts the active research familiar, tracks real execution, and
publishes durable knowledge artifacts with source provenance.

The Research Mission layer orchestrates existing Cave primitives instead of
creating another agent runtime:

- Flow sessions perform one-shot and iterative research.
- Codex Automations wake recurring missions and run one bounded continuation at
  a time.
- A mission-owned workspace carries state between sessions and automation
  ticks.
- Knowledge Vault stores validated Markdown deliverables.
- Existing sessions, run histories, and usage data remain the execution truth.

## Current State

`src/components/role-surfaces/researcher-surface.tsx` is a local-only analyst
notebook. It can open a DuckDuckGo query, persist objectives/notes/hypotheses
and hand-entered evidence in role-surface state, list familiar memories, and
jump to existing conversations. It cannot create familiar work, track an
execution, schedule continuation, or publish a research artifact.

The repository already supplies the underlying capabilities:

- `POST /api/flows/run` launches a real familiar-backed agent session and
  records ordered step progress.
- `/api/flows/runs` and `/api/flows/session-transcript` expose flow history and
  live output.
- `/api/chat/conversation/[id]` exposes persisted turns, usage, and cost when
  the harness reports them.
- `/api/knowledge` persists scoped Markdown knowledge entries.
- Codex Automations provide schedules, pause/resume, Run now, and run logs.
- Research Brief, Research Sweep, Research Paper, Deep Research, and the
  optional autoresearch craft already establish useful research vocabulary.

## Goals

1. Make one natural-language field the primary way to start research.
2. Route intent intelligently to a brief, sweep, paper, or autoresearch mission
   while keeping the inferred choice reviewable and overridable.
3. Show queued, planning, gathering, synthesizing, checkpoint, paused,
   completed, failed, and cancelled states from real runtime evidence.
4. Produce durable Markdown artifacts, structured source records, and a
   coherent findings narrative without requiring users to copy chat output.
5. Make iterative and recurring research resumable across sessions, Cave
   restarts, and automation ticks.
6. Bound autonomous work by wall-clock time, iteration count, cost policy, and
   human checkpoints.
7. Preserve honest offline, missing-capability, malformed-output, and
   budget-unavailable states.
8. Keep the role-surface architecture generic; the shell must not learn about
   Research Missions.

## Non-goals

- Building a second workflow engine, scheduler, chat store, or document editor.
- Treating HTML/React Canvas artifacts as research documents.
- Publishing externally or sending messages without a separate explicit
  approval.
- Guaranteeing a hard dollar limit when the selected harness does not report
  cost. The UI must distinguish enforced bounds from advisory ones.
- Running an unbounded background loop. Every continuation is one finite
  iteration and every series has a stopping policy.
- Requiring the optional marketplace autoresearch craft for basic research.

## Product Model

### Mission modes

The mode picker defaults to **Auto** and remains visible beside the primary
action.

| Mode | Auto-routing signal | Default deliverable | Default bounds |
| --- | --- | --- | --- |
| Brief | Question, comparison, recommendation, or summary | Cited brief | 20 minutes, 1 iteration, 6 source target |
| Sweep | Landscape, exhaustive scan, alternatives, or trend mapping | Research report + source ledger | 45 minutes, 1 iteration, 12 source target |
| Paper | Paper, whitepaper, literature review, or formal report | Markdown paper + bibliography | 90 minutes, 1 iteration, 8 distinct source minimum |
| Autoresearch | Optimize, investigate over time, experiment, keep researching, or explicit loop language | Findings narrative + research log + selected companion artifacts | 6 iterations, 4 hours total, checkpoint every iteration |

Auto-routing is deterministic and explainable. Explicit user selection always
wins. Ambiguous requests default to Brief; they do not silently start a long
loop. The active familiar performs substantive planning inside the first flow
step, so routing does not require a hidden preliminary model call.

### Primary journey

1. The empty Desk centers a multiline prompt: “What should we investigate?”
2. As the user types, the Desk shows compact plan chips: inferred mode,
   deliverable, source target, time limit, and loop policy.
3. A disclosure exposes audience, project/context, source constraints,
   iteration count, checkpoint policy, and spend policy.
4. **Start research** creates and starts the mission atomically. A failed launch
   leaves a visible retryable mission rather than losing the prompt.
5. The center pane becomes the selected mission timeline. It shows current
   phase, elapsed time, bounds, step progress, latest finding, and the active
   familiar session link.
6. The right rail shows artifacts and structured sources. Opening a published
   artifact routes to the existing Grimoire/Knowledge reader.
7. At a checkpoint, the user can Continue, Refine direction, Finish now, or
   Schedule. Completed missions can be continued as a new iteration without
   overwriting their provenance.

### Secondary journeys

- **One-shot to recurring:** Schedule creates a linked Codex Automation from
  the current mission and pauses at a review screen before activation.
- **One-shot to autoresearch:** Continue automatically changes only future
  iterations and requires explicit bounds; it never retroactively changes the
  completed run.
- **Conversation escape hatch:** Open session jumps into the real familiar
  thread. The Desk remains the mission overview, not a duplicate chat UI.
- **Manual browsing:** Sources still open in the Cave browser. Manual evidence
  can be attached to the selected mission rather than living in unscoped local
  state.

## Architecture

```text
Research Desk
    |
    v
/api/research/missions ----> research mission store + workspace
    |                                  |
    | start/continue                    | state, findings, sources, artifacts
    v                                  v
existing Flow executor --------> familiar session / run history
    |
    | reconcile validated output
    v
Knowledge Vault <---------- mission artifact publisher
    ^
    |
linked Codex Automation ---- one bounded continuation per tick
```

### Module boundaries

| Unit | Responsibility |
| --- | --- |
| `src/lib/research-missions.ts` | Client-safe mission, iteration, artifact, source, bounds, and API types; status derivation helpers |
| `src/lib/research-mission-routing.ts` | Pure Auto-mode inference, defaults, labels, and review summary |
| `src/lib/research-mission-flow.ts` | Build the Flow document and orchestration prompts for one bounded iteration |
| `src/lib/research-artifact-contract.ts` | Validate state/control files, source records, Markdown artifacts, size caps, and status decisions |
| `src/lib/server/research-mission-store.ts` | Safe mission-id paths, atomic persistence, write serialization, archive cap, and workspace access |
| `src/lib/server/research-mission-runner.ts` | Create/start/continue/reconcile missions through existing Flow, session, Knowledge, and Automation APIs |
| `src/app/api/research/missions/**` | Loopback-gated HTTP surface for list, create/start, inspect, action, and schedule operations |
| `src/components/role-surfaces/research-mission-composer.tsx` | Natural-language intake and reviewable plan controls |
| `src/components/role-surfaces/research-mission-list.tsx` | Familiar-scoped mission navigation and status summaries |
| `src/components/role-surfaces/research-mission-detail.tsx` | Timeline, bounds, checkpoint actions, artifacts, and sources |
| `src/components/role-surfaces/researcher-surface.tsx` | Thin responsive composition of the mission components plus manual source/browser affordances |

No Research Mission identifier is added to `workspace.tsx`, `shell.tsx`, or
`sidebar-minimal.tsx`. The generic Role Surface context gains only narrowly
named capabilities if navigation cannot be expressed through existing
callbacks.

## Data Model

```ts
type ResearchMissionMode = "brief" | "sweep" | "paper" | "autoresearch";
type ResearchMissionStatus =
  | "queued"
  | "planning"
  | "running"
  | "checkpoint"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

type ResearchBounds = {
  wallClockMinutes: number;
  maxIterations: number;
  sourceTarget: number;
  maxSpendUsd?: number;
  checkpointEvery: number;
  stopWhenCostUnavailable: boolean;
};

type ResearchIteration = {
  number: number;
  status: "queued" | "running" | "checkpoint" | "completed" | "failed" | "cancelled";
  flowRunId?: string;
  sessionId?: string;
  automationRunId?: string;
  startedAt?: string;
  finishedAt?: string;
  costUsd?: number;
  summary?: string;
  decision?: "continue" | "checkpoint" | "complete";
  decisionReason?: string;
};

type ResearchArtifactRef = {
  key: string;
  kind: "brief" | "report" | "paper" | "findings" | "source-ledger" | "research-log" | "presentation";
  title: string;
  relativePath: string;
  knowledgeId?: string;
  iteration: number;
  state: "working" | "published" | "rejected";
  updatedAt: string;
};

type ResearchSourceRef = {
  id: string;
  title: string;
  url?: string;
  localPath?: string;
  publisher?: string;
  publishedAt?: string;
  sourceType: string;
  claim?: string;
  confidence?: number;
  status: "candidate" | "used" | "conflicting" | "rejected";
};

type ResearchMission = {
  version: 1;
  id: string;
  familiarId: string;
  title: string;
  intent: string;
  mode: ResearchMissionMode;
  modeSource: "auto" | "user";
  deliverable: string;
  audience?: string;
  projectRoot?: string;
  constraints: string[];
  bounds: ResearchBounds;
  status: ResearchMissionStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  automationId?: string;
  iterations: ResearchIteration[];
  artifacts: ResearchArtifactRef[];
  sources: ResearchSourceRef[];
  lastError?: string;
};
```

Mission files live under
`~/.coven/cave/research-missions/<validated-mission-id>/`:

```text
mission.json
research-state.yaml
findings.md
research-log.md
sources.json
artifacts/
  primary.md
  source-ledger.md
  presentation.html       # optional
```

The global list is derived from mission directories; there is no second index
that can drift. Mission ids use the same strict slug/path-containment posture as
Knowledge Vault. Writes are atomic and serialized per store. Large text lives
in artifact files, not `mission.json`.

## Execution Contract

### Creating and starting

`POST /api/research/missions` accepts the familiar id, intent, explicit or Auto
mode, review fields, bounds, and `start: true`. The server:

1. Validates the familiar, mode, bounds, optional project root, and local
   request authority.
2. Creates the mission workspace and initial files.
3. Builds a Flow snapshot for iteration 1.
4. Starts it through the existing Flow executor.
5. Records the Flow run/session ids before responding.

If step 4 fails, the mission remains `failed` with its input and a retry action.
The route never reports a preview as execution.

### Per-iteration Flow

Every mode compiles to these conceptual phases:

1. **Scope:** turn intent and existing findings into questions, inclusion rules,
   and an evidence standard.
2. **Gather:** search primary sources, local knowledge, and approved project
   context.
3. **Challenge:** identify weak evidence, contradictions, duplication, and
   unanswered claims.
4. **Synthesize:** update the coherent findings narrative and primary artifact.
5. **Control:** choose continue, checkpoint, or complete against the explicit
   bounds and evidence quality.
6. **Publish working files:** atomically replace state, sources, log, and
   artifact files in the mission workspace.

The Flow executor remains responsible for session creation and `@@step-*`
progress markers. The mission prompt adds these exact bare-line markers at the
end of a successful iteration:

```text
@@research-control
{"decision":"checkpoint","reason":"Primary evidence conflicts on adoption rate","confidence":0.68}
@@research-artifacts-written
```

The JSON line is limited to decision, reason, and confidence. Sources and
artifact bodies are read from validated workspace files, not embedded in the
transcript. Missing or malformed control output always becomes a checkpoint;
it never authorizes another automatic iteration.

### Reconciliation

Mission GET/action routes reconcile before returning:

1. Read the linked Flow run and session status.
2. Aggregate usage/cost from persisted conversation turns when available.
3. Enforce elapsed-time and iteration bounds before starting more work.
4. Validate workspace files and reject symlinks, out-of-root paths, oversized
   files, malformed source records, and unsupported artifact types.
5. Publish valid Markdown artifacts into Knowledge Vault with familiar scope,
   tags `research`, `mission:<id>`, mode, artifact kind, and a provenance header
   naming mission, iteration, run, and session.
6. Update mission status and surface any validation problem as a checkpoint or
   failure with a concrete repair action.

The canonical Knowledge id is `research-<mission-id>-<artifact-key>`. Working
iterations update that entry; run/session links preserve the revision trail.

## Autoresearch and Automations

Autoresearch is a series of finite iterations, not one immortal process.

- Each iteration rereads `research-state.yaml`, `findings.md`, `sources.json`,
  and the latest artifacts before acting.
- Each iteration must add evidence, test/refute a hypothesis, repair a broken
  assumption, or conclude. Repeating the previous plan without new evidence is
  not valid progress.
- `checkpointEvery` is enforced even when the agent asks to continue.
- Continue is denied after `maxIterations` or `wallClockMinutes`.
- When reported cumulative cost reaches `maxSpendUsd`, the mission pauses.
- If cost is unavailable and `stopWhenCostUnavailable` is true, the mission
  pauses before the next iteration with “Cost unavailable; approve continuation.”
- A complete decision disables the linked automation and publishes final
  artifacts.

Scheduling creates a standard Codex Automation with:

- the research familiar selected;
- the mission workspace as its working directory;
- the optional installed autoresearch skill selected when available;
- tags `research-mission` and `research-mission:<id>`;
- a continuation prompt containing the mission id, bounded one-iteration
  contract, workspace file contract, and stop rules.

The Desk stores only `automationId`; the Automation TOML remains schedule truth.
Pause/resume and Run now use existing Automation routes. On return, the Desk
reconciles automation logs and workspace changes into a new mission iteration.
If an external scheduled tick produces no valid state change, the mission shows
“Automation ran without a valid research checkpoint” and pauses rather than
pretending progress.

## API Surface

| Endpoint | Behavior |
| --- | --- |
| `GET /api/research/missions?familiarId=` | List familiar-scoped mission summaries after lightweight reconciliation |
| `POST /api/research/missions` | Create and optionally start a mission atomically |
| `GET /api/research/missions/[id]` | Return reconciled detail, artifacts, sources, bounds, iterations, and actions |
| `POST /api/research/missions/[id]/actions` | Execute `retry`, `continue`, `checkpoint`, `finish`, `pause`, `cancel`, or `archive` after state validation |
| `POST /api/research/missions/[id]/schedule` | Create or update the linked Codex Automation in paused review state |

Mutations are loopback/sidecar-auth gated using existing API security helpers.
Actions are idempotent: a second Continue while an iteration is active returns
the active iteration instead of spawning duplicate work.

## Research Desk UI

### Wide panes

- **Left rail:** New mission button, All/Active/Needs review/Completed filters,
  mission rows with status dot + word, mode, and relative update time.
- **Center:** mission composer when creating; otherwise title, bound chips,
  current-phase banner, ordered step timeline, latest finding, and primary
  checkpoint actions.
- **Right rail:** artifact shelf first, then source/evidence ledger, followed by
  linked session and automation.
- **Bottom drawer:** research log and iteration history. The drawer is secondary
  evidence, not the primary action surface.

### Narrow panes and mobile

The component responds to its container, not viewport width. Below the
three-column threshold, the left rail becomes a mission switcher and the right
rail becomes accessible Artifacts/Sources tabs below the timeline. All primary
actions remain visible without hover. No fixed desktop-only inspector width is
assumed.

### Empty and transitional states

- No missions: composer plus three concrete examples; no fake recent work.
- Daemon offline: intake remains editable; Start is disabled with the exact
  recovery action.
- Launching: persisted queued mission with a cancellable progress state.
- No artifacts yet: show the current phase and expected deliverable.
- Artifact validation failed: show the rejected filename and reason; retain the
  raw file in the mission workspace for repair.
- Automation unavailable: one-shot research remains usable; scheduling explains
  the missing Codex automation capability.

## Error Handling and Safety

- Reject empty intent, unknown familiar, invalid ids, unsafe paths, non-local
  mutations, non-finite bounds, and bounds outside product limits.
- Clamp source counts, artifact sizes, log sizes, and retained mission count.
- Serialize mission mutations and recheck active status inside the lock to
  prevent double-start races.
- Never follow symlinks from a mission workspace when publishing artifacts.
- Never include secrets, environment values, raw tool credentials, or hidden
  prompts in knowledge artifacts or mission API responses.
- Cancellation kills the linked active session through the existing session
  endpoint, marks the iteration cancelled, and disables future automation. It
  does not delete prior artifacts.
- Archive hides a mission but preserves provenance. Destructive deletion is not
  part of this design.
- Offline Travel queue responses remain queued and are not shown as running.
- Publication, external messaging, and scope expansion always require a
  separate user action outside the research loop.

## Accessibility

- Mission rows use status dot + visible status word; color is never the only
  signal.
- The selected mission uses `aria-current`; filters and artifact/source modes
  use the shared Tabs primitive.
- Launch, phase changes, checkpoint arrival, failure, cancellation, and artifact
  publication are announced through the shared live-region announcer.
- Timeline items form an ordered list with textual state.
- Composer labels, bound controls, disclosures, and error messages are
  programmatically associated.
- Keyboard users can create, switch, continue, pause, open artifacts, and open
  the linked session without entering a hover-only menu.
- Reduced-motion preferences disable phase pulses and timeline transitions.

## Testing Strategy

### Pure and server tests

- Auto-routing signals, explicit override, default bounds, and bound validation.
- Mission status/action derivation, idempotent Continue, checkpoint rules, and
  terminal-state transitions.
- Flow builder order, prompt contracts, exact bare-line markers, mode-specific
  deliverables, and persisted snapshot metadata.
- Mission store path containment, symlink rejection, atomic writes, concurrent
  updates, archive behavior, and caps.
- Artifact/state/source validation, malformed-control fallback, provenance
  header generation, and Knowledge id stability.
- Reconciliation of Flow/session status, cost-available and cost-unavailable
  policies, queued Travel execution, and duplicate automation ticks.
- API local-auth gates, invalid input responses, and action idempotency.

### Component tests

- Composer exposes Auto mode, review chips, bounds disclosure, and honest
  disabled/error states.
- Mission list filters, selected state, status words, and container-responsive
  fallback.
- Detail timeline renders real phases, checkpoints, usage/bounds, artifacts,
  sources, and linked execution controls.
- Scheduling stays paused for review; pause/resume/Run now map to existing
  Automation routes.
- Live-region announcements and keyboard access cover each primary transition.
- Role-surface shell-purity guard remains green.

### Integrated verification

1. Run focused mission, flow, knowledge, automation, API-contract, and component
   tests through the wired app suite.
2. Run `pnpm check:tests-wired`, `pnpm typecheck`, and `pnpm test:app`.
3. Launch the native desktop app with `bash scripts/dev-app.sh`.
4. With a real research familiar, create a Brief mission and verify session
   launch, step progress, artifact publication, Knowledge navigation, and
   restart recovery.
5. Create a two-iteration autoresearch mission, verify checkpoint stopping,
   Continue, automation creation in paused review state, Run now, and final
   automation disablement.
6. Verify daemon-offline, malformed artifact, cost-unavailable, cancellation,
   and narrow-pane states in the real app.

## Delivery Slices

### Slice 1: Mission spine and one-shot factory

Ship routing, mission store/workspace, Flow builder/runner, create/start/list/
detail APIs, Brief/Sweep/Paper modes, artifact validation/publication, and the
mission-first Desk. This slice ends with a real cited Markdown artifact in
Knowledge and a resumable mission record.

### Slice 2: Control plane and evidence quality

Ship iteration history, structured sources, checkpoints, continue/refine/
finish/cancel actions, usage and cost reconciliation, research log drawer,
manual evidence attachment, and richer failure recovery.

### Slice 3: Autoresearch and recurring production

Ship autoresearch state files, control decisions, loop bounds, Codex Automation
creation/linking, pause/resume/Run now, scheduled-tick reconciliation, and final
automation shutdown.

Each slice must be independently testable and leave the Desk honest when later
slices are absent. Slice 1 does not show nonfunctional Schedule or Loop buttons;
Slice 2 does not imply recurring execution until Slice 3 exists.

## Acceptance Audit

The full objective is complete only when current evidence proves all of the
following:

- Natural-language Start research launches the selected research familiar.
- Auto-routing is visible, explainable, and overridable.
- Brief, Sweep, Paper, and Autoresearch modes produce their specified durable
  artifacts.
- Mission state and artifacts survive app/session restarts.
- Live phases and terminal states come from actual run/session evidence.
- Artifacts open from the Desk and are discoverable in Knowledge/Grimoire.
- Sources retain usable provenance and conflict/rejection states.
- Continue, checkpoint, finish, pause, cancel, retry, and archive respect the
  mission lifecycle and do not duplicate work.
- Recurring work is backed by a linked, reviewable Codex Automation.
- Iteration, time, cost-availability, and checkpoint bounds stop autonomous
  continuation as designed.
- Offline, unavailable, malformed-output, and partial-failure states remain
  explicit and recoverable.
- Desktop and narrow-pane interaction, keyboard access, announcements, tests,
  typechecking, and native-app verification all pass.
