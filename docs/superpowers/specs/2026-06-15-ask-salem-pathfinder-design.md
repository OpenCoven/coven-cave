# Ask Salem Pathfinder Design

**Date:** 2026-06-15
**Status:** Approved

## Purpose

Extend Salem from a Cave docs familiar into the Coven's contextual pathfinder. Salem should help new users and existing builders choose the right OpenCoven path, then render that recommendation as a native Cave card with concrete next steps.

The approved v0 shape has two entry points that share one Salem brain:

- **Setup Salem:** onboarding and rescue mode for first run, missing runtime state, failed doctor checks, empty familiar roster, and setup diagnostics.
- **Home Salem:** ongoing guide mode from the normal Cave home/sidebar and empty states across Projects, Board, Library, Workflows, and related surfaces.

Salem should eventually support whenever and however it applies to the Coven. v0 stays small: five canonical happy paths, structured generation, rendered cards, and optional Board checklist creation.

## Goals

- Give users one recommended next path instead of a full ecosystem dump.
- Reuse the existing Salem rail, 3D avatar, persona context, and API surface.
- Add a canonical happy path registry that Salem can use as source-of-truth context.
- Let Salem generate live, adaptive guidance while keeping products, links, commands, and actions bounded by the registry.
- Render Salem's path output as Cave-native cards, checklists, links, commands, and next-action buttons.
- Support both setup/onboarding and normal home usage from day one.
- Allow users to save a recommended path as a Cave Board checklist.
- Keep v0 non-autonomous: Salem recommends and routes, but does not claim to complete setup actions.

## Non-Goals For v0

- No fine-tuning or preference training.
- No full autonomous installation or setup.
- No coverage for every OpenCoven repo.
- No multi-agent delegation.
- No generic support bot behavior beyond pathfinding and immediate Cave setup guidance.
- No cloud telemetry requirement.
- No hidden external state changes. Board creation is explicit and user-initiated.

## Product Shape

### Setup Salem

Setup Salem appears where the user is most likely to be blocked:

- First-run setup.
- Missing `coven` CLI or unhealthy daemon.
- Failed `coven doctor`.
- Empty familiar roster.
- Setup diagnostics panel.

Setup Salem's job is to reduce confusion and pick the first viable path. It can use setup context such as platform, detected CLI state, daemon health, runtime checks, existing familiar count, and current setup step.

The rendered result should include:

- One recommendation card.
- A short explanation of why this path fits.
- A checklist with 3 to 6 steps.
- Copyable commands when relevant.
- A primary next action such as `Open setup`, `Run doctor`, `Install Coven CLI`, or `Choose runtime`.
- Secondary actions: `Ask a follow-up`, `Use a different path`, and `Save to Board`.

### Home Salem

Home Salem appears as the ongoing Coven guide:

- Sidebar or rail entry: `Ask Salem`.
- Home dashboard panel: `Find your next path`.
- Empty states across Projects, Board, Library, Workflows, and related pages.

Home Salem's job is to help users decide what to do next in the ecosystem. It can use home context such as the current Cave surface, selected project, active familiar, Board state, available runtimes, and user-entered intent.

The rendered result should include:

- One recommended path.
- The relevant product/repo.
- Steps and links.
- A clear next action.
- Optional Board checklist creation.
- Follow-up chat that can adapt the path if the user says things like `I am on Windows`, `I prefer terminal`, `I already have Codex`, or `I want the spec path instead`.

## Canonical v0 Paths

The v0 registry starts with five paths:

1. **First familiar in Cave**
   - Product: Coven Cave.
   - User intent: "I want a familiar on my machine."
   - Success moment: user can talk to a named familiar and see its work in Cave.

2. **Coding workspace with CastCodes**
   - Product: CastCodes.
   - User intent: "I want a desktop AI coding workspace."
   - Success moment: user can run a visible project-scoped agent session and review changes.

3. **Terminal agent with Coven Code**
   - Product: Coven Code.
   - User intent: "I want a terminal/TUI agent."
   - Success moment: user can launch Coven Code, connect a provider, and work in a project.

4. **Runtime builder with OpenCoven/coven**
   - Repo: `OpenCoven/coven`.
   - User intent: "I want to understand or build the runtime."
   - Success moment: user understands Coven as the local harness substrate and can run a daemon-backed session.

5. **Familiar identity/spec with familiar-contract**
   - Repo: `OpenCoven/familiar-contract`.
   - User intent: "I want to define a familiar properly."
   - Success moment: user has identity, purpose, memory, authority, and human belonging captured in a compliant familiar directory.

v1 can add Grimoire/podcast learning, contributor, dashboard/orchestration, release/operator, and support/debugging paths once real usage reveals which paths are requested.

## Registry Design

The registry should live in Cave for v0 so the feature can ship without coordinating multiple repos. It can move to `coven-docs` or a shared package after another surface needs the same data.

Recommended initial file:

- `src/lib/salem/happy-paths.json`
- `src/lib/salem/happy-paths.schema.json`
- `src/lib/salem/happy-paths.ts`

The TypeScript wrapper should validate and export typed path data for Salem prompts, UI rendering, and tests.

### Registry Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "SalemHappyPathRegistry",
  "type": "object",
  "required": ["version", "paths"],
  "properties": {
    "version": { "type": "string" },
    "paths": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/$defs/path" }
    }
  },
  "$defs": {
    "path": {
      "type": "object",
      "required": [
        "id",
        "title",
        "audiences",
        "intents",
        "surface",
        "primaryTarget",
        "summary",
        "prerequisites",
        "steps",
        "successMoment",
        "blockers",
        "links",
        "maturity"
      ],
      "properties": {
        "id": { "type": "string" },
        "title": { "type": "string" },
        "audiences": {
          "type": "array",
          "items": { "type": "string" }
        },
        "intents": {
          "type": "array",
          "items": { "type": "string" }
        },
        "surface": {
          "type": "string",
          "enum": ["setup", "home", "both"]
        },
        "primaryTarget": {
          "type": "object",
          "required": ["kind", "name"],
          "properties": {
            "kind": { "type": "string", "enum": ["cave-route", "repo", "product", "external-link"] },
            "name": { "type": "string" },
            "route": { "type": "string" },
            "repo": { "type": "string" },
            "url": { "type": "string" }
          }
        },
        "summary": { "type": "string" },
        "prerequisites": {
          "type": "array",
          "items": { "type": "string" }
        },
        "steps": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/step" }
        },
        "successMoment": { "type": "string" },
        "blockers": {
          "type": "array",
          "items": { "$ref": "#/$defs/blocker" }
        },
        "links": {
          "type": "array",
          "items": { "$ref": "#/$defs/link" }
        },
        "maturity": {
          "type": "string",
          "enum": ["experimental", "beta", "stable-ish"]
        }
      }
    },
    "step": {
      "type": "object",
      "required": ["id", "title", "body"],
      "properties": {
        "id": { "type": "string" },
        "title": { "type": "string" },
        "body": { "type": "string" },
        "command": { "type": "string" },
        "caveAction": { "$ref": "#/$defs/action" }
      }
    },
    "blocker": {
      "type": "object",
      "required": ["label", "suggestion"],
      "properties": {
        "label": { "type": "string" },
        "suggestion": { "type": "string" }
      }
    },
    "link": {
      "type": "object",
      "required": ["label", "url"],
      "properties": {
        "label": { "type": "string" },
        "url": { "type": "string" }
      }
    },
    "action": {
      "type": "object",
      "required": ["kind", "label"],
      "properties": {
        "kind": {
          "type": "string",
          "enum": ["cave-route", "copy-command", "run-doctor", "save-board-checklist", "external-link"]
        },
        "label": { "type": "string" },
        "target": { "type": "string" }
      }
    }
  }
}
```

## Salem Response Contract

Salem should return structured JSON that Cave can render, plus a short human-readable summary for the chat transcript. The UI should trust only registry-backed IDs, links, commands, and action kinds.

```ts
type SalemPathfinderMode = "setup" | "home";

type SalemPathfinderRequest = {
  mode: SalemPathfinderMode;
  userMessage: string;
  currentSurface?: "setup" | "home" | "projects" | "board" | "library" | "workflows" | "chat";
  machineState?: {
    platform?: "macos" | "windows" | "linux" | "unknown";
    covenCli?: "healthy" | "missing" | "unhealthy" | "unknown";
    daemon?: "running" | "stopped" | "unhealthy" | "unknown";
    runtimes?: Array<{ id: string; label: string; status: "healthy" | "missing" | "unhealthy" }>;
    familiarCount?: number;
  };
  caveState?: {
    activeProjectId?: string;
    activeFamiliarId?: string;
    boardCardCount?: number;
    workflowCount?: number;
  };
};

type SalemPathfinderCard = {
  schemaVersion: "salem.pathfinder.v1";
  mode: SalemPathfinderMode;
  recommendedPathId: string;
  confidence: "high" | "medium" | "low";
  title: string;
  summary: string;
  why: string;
  assumptions: string[];
  steps: Array<{
    id: string;
    title: string;
    body: string;
    command?: string;
    status?: "ready" | "blocked" | "optional";
  }>;
  links: Array<{ label: string; url: string }>;
  blockers: Array<{ label: string; suggestion: string }>;
  primaryAction: {
    kind: "cave-route" | "copy-command" | "run-doctor" | "save-board-checklist" | "external-link";
    label: string;
    target?: string;
  };
  secondaryActions: Array<{
    kind: "cave-route" | "copy-command" | "run-doctor" | "save-board-checklist" | "external-link";
    label: string;
    target?: string;
  }>;
  transcriptSummary: string;
};
```

The response must not contain arbitrary executable code. Commands must come from the registry or be generated from whitelisted templates such as package install commands with known package names.

## Prompting And Generation

Salem's v0 system prompt should say:

```text
You are Salem, Cave's pathfinder familiar. Help the user choose one OpenCoven happy path.
Use the happy path registry as source-of-truth. Recommend one best next path, not a list of equal options.
Ask at most two clarifying questions only when the current request cannot map to a safe path.
Return a structured pathfinder card. Do not claim that you performed setup, installs, commits, pushes, or external actions unless Cave provided tool evidence.
Keep explanations concise, practical, and Cave-native.
```

Prompt context should include:

- Existing Salem identity/preload context.
- The happy path registry.
- Mode-specific context: setup state or home state.
- Current user message and short conversation history.

The API should validate Salem's JSON before rendering. Invalid JSON falls back to a normal Salem chat answer plus a compact error state saying the rendered path could not be generated.

## UI Design

Use existing Cave operational UI language:

- Compact cards with 8px-or-less radius.
- Icon buttons for route, copy, run doctor, save to board, and external link actions.
- No marketing hero and no explanatory page copy walls.
- Command blocks are copyable and visually distinct.
- The primary action is a single clear button.
- Secondary actions are lower-emphasis.
- Follow-up chat remains available beneath or beside the rendered card.

Suggested components:

- `src/components/salem/salem-pathfinder-card.tsx`
- `src/components/salem/salem-pathfinder-entry.tsx`
- `src/components/salem/salem-pathfinder-actions.tsx`
- `src/lib/salem/pathfinder-types.ts`
- `src/lib/salem/pathfinder-registry.ts`

Setup surfaces should use a slimmer version of the card so the user remains inside setup. Home surfaces can show the full card with links and optional Board creation.

## Data Flow

1. A setup or home entry point opens Salem with a `mode`.
2. Cave collects safe local context for that mode.
3. The client posts `SalemPathfinderRequest` to a Salem pathfinder route.
4. The route loads the registry and Salem preload context.
5. The model returns a `SalemPathfinderCard`.
6. The route validates and sanitizes the response.
7. Cave renders the card and appends `transcriptSummary` to Salem chat history.
8. If the user chooses `Save to Board`, Cave creates a Board card/checklist from the validated path steps after explicit confirmation.

Board checklist creation should use the same Board API as normal cards and include:

- Title: `Salem path: <path title>`
- Labels: `salem`, `happy-path`, and the path ID.
- Notes: recommendation summary, assumptions, links, and source registry version.
- Checklist steps copied from the validated card.

## Error Handling

- Missing registry: show Salem chat with a setup-safe fallback and log a local error.
- Invalid registry: disable rendered path cards and show a developer-facing diagnostics message in local builds.
- Model unavailable: show a deterministic registry-based fallback card for the closest path if the user intent maps clearly; otherwise ask one clarifying question.
- Invalid model JSON: keep the chat response but hide action buttons.
- Unknown action kind: drop that action before rendering.
- Unsafe command: drop the command and keep the step body.
- Board save failure: preserve the rendered card and show retry/error feedback.
- Daemon offline in setup mode: Salem can recommend daemon repair steps, but setup actions remain guarded by existing Cave setup/doctor controls.

## Privacy And Logging

v0 should keep learning local:

- Store selected path ID, mode, registry version, and whether the user saved to Board.
- Store user corrections as short local notes only when the user chooses to submit feedback or save the path.
- Do not send private project files, secrets, environment variables, gateway URLs, tokens, or raw logs to Salem.
- Do not require cloud telemetry.

These local traces can later become eval examples after explicit review and sanitization.

## Training Loop

Start with registry-grounded generation instead of fine-tuning:

1. Write canonical paths as structured data.
2. Use Salem's pathfinder prompt and strict response schema.
3. Render validated cards in Cave.
4. Capture local feedback and corrections.
5. Promote strong examples into a small eval set.
6. Add richer Cave actions once the recommendations are reliable.
7. Consider fine-tuning only after repeated real usage shows stable examples of good Salem behavior.

This keeps Salem current as the ecosystem changes.

## Testing Strategy

v0 implementation should include:

- Schema validation tests for the happy path registry.
- Pure tests for matching user intent and mode to allowed path IDs.
- API tests for valid card generation, invalid JSON fallback, unsafe command stripping, and unknown action dropping.
- Component/source tests that Setup Salem and Home Salem render the same card contract with different density.
- Board-save tests that card steps convert into a Cave Board checklist only after explicit user action.
- Existing Salem guard tests should remain passing: persona, right rail, route, preload, and no emoji glyph leakage.
- Typecheck before commit.

## Implementation Slices

### PR 1: Registry And Rendered Cards

- Add registry, schema, and typed loader.
- Add pathfinder response types.
- Add `SalemPathfinderCard` component.
- Add deterministic fixture data for the five v0 paths.
- Add validation and component/source tests.

### PR 2: Setup Entry Point

- Add setup-mode entry points.
- Pass safe setup/machine state into Salem.
- Wire setup-oriented actions such as route navigation, command copy, and doctor handoff.
- Add setup fallback states.

### PR 3: Home Entry Point And Board Save

- Add home/sidebar and empty-state entry points.
- Pass safe home/project/Board context into Salem.
- Add explicit `Save to Board` flow.
- Add Board card/checklist conversion tests.

### PR 4: Evals And Feedback Trail

- Add local feedback capture.
- Add sanitized eval fixtures.
- Add regression tests for common user intents and corrections.

## Approval State

Approved direction from Valentina:

- Salem should support whenever and however it applies to the Coven.
- Start smaller and grow.
- v0 should appear both in setup/onboarding and the normal Cave home experience.
- Salem v0 should be `Ask Salem: setup guide + home pathfinder`.
