# Research run surfaces

Cave treats research as a durable run, not as a loading animation.

The canonical durable object today is `ResearchMission`. Chat, Quick Chat, and the Research Desk are projections of that same mission. A research provider or skill may report progress, but it does not own Cave UI state.

> **One run, many projections.**

## Ownership

| Layer | Responsibility |
| --- | --- |
| Research mission store/API | Canonical persisted run state, steps, sources, artifacts, timestamps |
| Research runner | Execution lifecycle and mission mutations |
| `researchMissionToRunSurface` | Provider-independent presentation projection |
| `ResearchRunSurface` | Shared visual language for compact research progress |
| Chat marker | Stable run reference plus an initial/degraded snapshot |
| Research Desk | Rich workspace projection over the same `ResearchMission` |

The Research Desk already reads `ResearchMission` directly through `useResearchMissions`, including polling, controls, evidence, artifacts, checkpoints, and diagnostics. The chat projection therefore must not create a second persisted research model.

## Chat transport

A Coven-native research skill can attach a compact marker to an assistant turn:

```xml
<coven:research
  run-id="mission-id"
  title="Bead dependency risk research"
  status="running"
  familiar="sage"
  skill="research:paper"
  runtime="codex · gpt-5"
  activity="Surveying dependency-lock-in incidents"
  step="2"
  total="5"
  sources="18"
  reviewed="12"
  retained="7"
  cited="3"
  artifacts="1"
/>
```

Only `run-id`, `title`, and `status` are required. Everything else is an optional initial snapshot. The marker is control metadata and is removed from user-visible prose. Fenced examples stay literal, and partial markers are hidden while a response streams.

Repeated markers for the same run in one assistant turn are reconciled by keeping the final complete snapshot.

### Status vocabulary

- `planning`
- `queued`
- `running`
- `awaiting_input`
- `awaiting_authority`
- `paused`
- `completed`
- `partial`
- `failed`
- `cancelled`

Research missions map `checkpoint` to `awaiting_input`. `awaiting_authority` and `partial` remain available for research executors that can report those states explicitly.

## Rehydration

`ResearchRunInlineCard` treats the marker as a bootstrap snapshot only:

1. Render the persisted snapshot immediately.
2. Fetch `/api/research/missions/:runId`.
3. When a canonical mission exists, project it through `researchMissionToRunSurface`.
4. Poll every two seconds while the mission can still change.
5. On transport loss, keep the last truthful projection visible and retry.
6. Stop polling after a terminal state.

This makes a card resilient to navigation and reload while preventing chat from becoming a second source of truth. A provider-only marker that has not materialized as a local mission still renders from its persisted snapshot.

## Progress semantics

Research progress must not imply precision that the executor does not have.

- Stage progress is expressed as `N of M stages resolved` so skipped stages do not read as completed work.
- The activity bar is indeterminate unless measured work exists.
- A percentage must only be introduced when the executor can supply a real denominator.
- ETA must come from execution telemetry, not model intuition.

Recorded mission sources are labeled `sources`; Cave does not call them `reviewed` unless an executor explicitly supplies a reviewed count.

## Plan semantics

Display steps support:

- `pending`
- `active`
- `completed`
- `blocked`
- `failed`
- `skipped`

The canonical Research Desk remains responsible for richer iteration history and checkpoints. The compact surface deliberately presents the current projection rather than pretending an initial plan is immutable.

## Controls

When backed by a canonical mission, the inline card exposes only actions allowed by the mission authority for the current state:

- resume when paused
- cancel, presented as Stop, while the mission is live or paused

A control failure is surfaced inline and never mutates the card optimistically into a false state.

## Evidence semantics

The surface model keeps evidence counters distinct:

- `sources`: source records currently attached to the run
- `reviewed`: explicitly reported reviewed count
- `retained`: sources accepted/used by the run
- `rejected`: sources rejected by the run
- `cited`: explicitly reported citation count
- `artifacts`: current non-rejected artifacts

Do not derive `reviewed` from `sources.length`.

## Privacy and reasoning boundary

`activity` and step `detail` are user-safe operational summaries. They may describe observable work such as “Reviewing incidents” or “Comparing release histories.” They must not expose private chain-of-thought.

The run identifier is a reference to persisted Cave state. Skills should not embed source bodies, credentials, private paths, or hidden reasoning in marker attributes.

## Accessibility

- Step state is conveyed by icon/shape as well as color.
- Current activity uses a polite live region.
- Indeterminate progress uses `role="progressbar"` with an explicit `aria-valuetext`.
- Motion is disabled under reduced-motion preferences.
- Resume and Stop use labeled buttons rather than icon-only state changes.

## Extension path

Future work can add richer event delivery (for example SSE or a Threads-backed event log) without changing the presentation contract. The invariant is that provider events are adapted into the OpenCoven-owned run projection; external provider schemas never become the Cave component API.
