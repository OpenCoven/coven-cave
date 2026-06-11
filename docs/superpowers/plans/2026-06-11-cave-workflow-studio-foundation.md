# Cave Workflow Studio Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship PR 1 of Cave Workflow Studio: a dedicated n8n-like Workflows surface with a graph canvas, library, node palette, inspector, attachments panel, manifest preview, validate/dry-run controls, and guarded play shell.

**Architecture:** Keep canonical workflow data in the existing Cave workflow client and daemon proxy routes. Add a pure workflow-to-graph model helper, then compose focused React components under `src/components/workflows/`. Use `@xyflow/react` for the graph canvas because the package supports the current React 19 stack and matches the claw-dash workflow builder direction.

**Tech Stack:** Next.js 16, React 19, TypeScript, `@xyflow/react`, existing Cave API proxy routes, source-level Node tests, and Cave CSS tokens.

---

## File Structure

- Modify: `package.json` and `pnpm-lock.yaml` to add `@xyflow/react@12.11.0`.
- Modify: `src/app/globals.css` to import React Flow CSS and the new workflow styles.
- Modify: `src/lib/workflows.ts` to add optional manifest detail fields used by the Studio.
- Create: `src/lib/workflow-graph.ts` for pure graph conversion.
- Create: `src/lib/workflow-graph.test.ts` for pure graph tests.
- Replace: `src/components/workflows-view.tsx` with the Studio container and API action orchestration.
- Create: `src/components/workflows/workflow-studio.tsx` for the page composition.
- Create: `src/components/workflows/workflow-library.tsx` for workflow selection and health.
- Create: `src/components/workflows/workflow-canvas.tsx` for the React Flow canvas.
- Create: `src/components/workflows/workflow-inspector.tsx` for selected node/workflow details.
- Create: `src/components/workflows/workflow-attachments.tsx` for familiar/role/board/project attach UX.
- Create: `src/components/workflows/workflow-run-strip.tsx` for validate, dry-run, guarded play, and plan summary.
- Create: `src/components/workflows/workflow-manifest-preview.tsx` for read-only manifest summary.
- Create: `src/styles/workflows.css` for Cave-native Studio styling.
- Modify: `src/components/workflows-view.test.ts` to assert the upgraded surface.
- Create: `src/components/workflows/workflow-studio.test.ts` for source-level component coverage.
- Modify: `package.json` `test:app` to run `src/lib/workflow-graph.test.ts` and `src/components/workflows/workflow-studio.test.ts`.

---

### Task 1: Add React Flow Dependency

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add dependency**

Run:

```bash
pnpm add @xyflow/react@12.11.0
```

Expected: `package.json` gains `@xyflow/react`, and `pnpm-lock.yaml` updates without peer dependency failures.

- [ ] **Step 2: Import required styles**

Modify `src/app/globals.css` near the existing imports:

```css
@import "tailwindcss";
@import "@xterm/xterm/css/xterm.css";
@import "@xyflow/react/dist/style.css";
@import "../styles/cave-chat.css";
@import "../styles/sidebar-minimal.css";
@import "../styles/home-composer.css";
@import "../styles/workflows.css";
```

- [ ] **Step 3: Verify dependency install**

Run:

```bash
pnpm exec tsc --noEmit
```

Expected: TypeScript reaches the current baseline with no new errors from `@xyflow/react`.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/app/globals.css
git commit -m "chore: add workflow graph canvas dependency"
```

---

### Task 2: Add Workflow Graph Model

**Files:**
- Modify: `src/lib/workflows.ts`
- Create: `src/lib/workflow-graph.ts`
- Create: `src/lib/workflow-graph.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing graph test**

Create `src/lib/workflow-graph.test.ts`:

```ts
import assert from "node:assert/strict";
import { workflowToGraph, workflowNodeTone } from "./workflow-graph.ts";
import type { WorkflowSummary } from "./workflows.ts";

const workflow: WorkflowSummary = {
  id: "nova-release-review",
  version: "1.0.0",
  name: "Release Review",
  summary: "Review a release with gate, familiar, validator, and output.",
  familiar: "nova",
  pattern: "sequential",
  validation_state: "valid",
  steps: [
    { id: "gate", kind: "human-gate", name: "Val approval", uses: "valentina" },
    { id: "review", kind: "agent", name: "Nova review", uses: "nova" },
    { id: "lint", kind: "skill", name: "Schema lint", uses: "cwf-validator@^1.0.0" },
    { id: "brief", kind: "tool", name: "Release brief", uses: "cave.output" },
  ],
};

const graph = workflowToGraph(workflow);

assert.equal(graph.nodes.length, 4, "each workflow step becomes a graph node");
assert.equal(graph.edges.length, 3, "sequential workflows connect adjacent steps");
assert.equal(graph.nodes[0].id, "gate", "node IDs use stable step IDs");
assert.equal(graph.nodes[0].data.kind, "human-gate", "node data preserves step kind");
assert.equal(graph.nodes[0].data.tone, "gate", "human gates use gate tone");
assert.equal(graph.nodes[1].position.x > graph.nodes[0].position.x, true, "nodes are laid out left to right");
assert.equal(workflowNodeTone("workflow"), "workflow", "nested workflow nodes get workflow tone");

const fallback = workflowToGraph({ id: "empty", version: "0.1.0", validation_state: "unknown" });
assert.equal(fallback.nodes.length, 1, "missing steps render an overview node");
assert.equal(fallback.nodes[0].data.kind, "workflow", "fallback node is a workflow overview");

console.log("workflow-graph.test.ts: ok");
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --experimental-strip-types src/lib/workflow-graph.test.ts
```

Expected: FAIL with `Cannot find module './workflow-graph.ts'`.

- [ ] **Step 3: Extend workflow types**

In `src/lib/workflows.ts`, add these types after `WorkflowPattern` and add optional fields to `WorkflowSummary`:

```ts
export type WorkflowStepKind = "agent" | "skill" | "tool" | "human-gate" | "workflow" | string;

export type WorkflowStepSummary = {
  id: string;
  kind: WorkflowStepKind;
  name?: string;
  uses?: string;
  summary?: string;
  requires?: string[];
  permissions?: string[];
  on_error?: string;
};
```

Update `WorkflowSummary`:

```ts
export type WorkflowSummary = {
  id: string;
  version: string;
  name?: string;
  summary?: string;
  familiar?: string;
  pattern?: WorkflowPattern | string;
  path?: string;
  validation_state?: "valid" | "warning" | "invalid" | "unknown";
  steps?: WorkflowStepSummary[];
  tags?: string[];
  limits?: {
    max_agents?: number;
    timeout_s?: number;
    cost_ceiling_usd?: number;
  };
  permissions?: string[];
  visibility?: {
    coven_code?: boolean;
    coven_cave?: boolean;
  };
};
```

- [ ] **Step 4: Implement graph conversion**

Create `src/lib/workflow-graph.ts`:

```ts
import type { WorkflowDryRunPlan, WorkflowStepSummary, WorkflowSummary } from "./workflows";

export type WorkflowNodeTone = "agent" | "tool" | "gate" | "workflow" | "output" | "unknown";

export type WorkflowGraphNodeData = {
  label: string;
  kind: string;
  uses?: string;
  summary?: string;
  status?: "ready" | "blocked";
  tone: WorkflowNodeTone;
  issues: number;
};

export type WorkflowGraphNode = {
  id: string;
  type: "workflowStep";
  position: { x: number; y: number };
  data: WorkflowGraphNodeData;
};

export type WorkflowGraphEdge = {
  id: string;
  source: string;
  target: string;
  animated?: boolean;
};

export type WorkflowGraph = {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
};

export function workflowNodeTone(kind: string): WorkflowNodeTone {
  if (kind === "agent") return "agent";
  if (kind === "human-gate") return "gate";
  if (kind === "skill" || kind === "tool") return "tool";
  if (kind === "workflow") return "workflow";
  if (kind === "output") return "output";
  return "unknown";
}

function dryRunStepFor(id: string, dryRun?: WorkflowDryRunPlan) {
  return dryRun?.steps?.find((step) => step.id === id);
}

function fallbackStep(workflow: WorkflowSummary): WorkflowStepSummary {
  return {
    id: workflow.id,
    kind: "workflow",
    name: workflow.name ?? workflow.id,
    uses: workflow.familiar,
    summary: workflow.summary,
  };
}

export function workflowToGraph(
  workflow: WorkflowSummary,
  dryRun?: WorkflowDryRunPlan | null,
): WorkflowGraph {
  const steps = workflow.steps?.length ? workflow.steps : [fallbackStep(workflow)];
  const nodes: WorkflowGraphNode[] = steps.map((step, index) => {
    const planStep = dryRunStepFor(step.id, dryRun ?? undefined);
    return {
      id: step.id,
      type: "workflowStep",
      position: {
        x: 80 + index * 220,
        y: 90 + (index % 2) * 130,
      },
      data: {
        label: step.name ?? step.id,
        kind: step.kind,
        uses: step.uses,
        summary: step.summary,
        status: planStep?.status,
        tone: workflowNodeTone(step.kind),
        issues: planStep?.blockers?.length ?? 0,
      },
    };
  });

  const edges: WorkflowGraphEdge[] = nodes.slice(1).map((node, index) => ({
    id: `${nodes[index].id}->${node.id}`,
    source: nodes[index].id,
    target: node.id,
    animated: dryRun?.ok === true,
  }));

  return { nodes, edges };
}
```

- [ ] **Step 5: Add test script entry**

Modify `package.json` `test:app` so `src/lib/workflow-graph.test.ts` runs after `src/lib/workflows.test.ts`:

```json
"node --experimental-strip-types src/lib/workflows.test.ts && node --experimental-strip-types src/lib/workflow-graph.test.ts &&"
```

- [ ] **Step 6: Run graph tests**

Run:

```bash
node --experimental-strip-types src/lib/workflow-graph.test.ts
pnpm run test:app
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add package.json src/lib/workflows.ts src/lib/workflow-graph.ts src/lib/workflow-graph.test.ts
git commit -m "feat: model workflow graphs"
```

---

### Task 3: Build Studio Component Shell

**Files:**
- Create: `src/components/workflows/workflow-studio.tsx`
- Create: `src/components/workflows/workflow-library.tsx`
- Create: `src/components/workflows/workflow-canvas.tsx`
- Create: `src/components/workflows/workflow-inspector.tsx`
- Create: `src/components/workflows/workflow-attachments.tsx`
- Create: `src/components/workflows/workflow-run-strip.tsx`
- Create: `src/components/workflows/workflow-manifest-preview.tsx`
- Create: `src/components/workflows/workflow-studio.test.ts`
- Create: `src/styles/workflows.css`
- Modify: `package.json`

- [ ] **Step 1: Write the failing source test**

Create `src/components/workflows/workflow-studio.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const studio = read("./workflow-studio.tsx");
const canvas = read("./workflow-canvas.tsx");
const library = read("./workflow-library.tsx");
const inspector = read("./workflow-inspector.tsx");
const attachments = read("./workflow-attachments.tsx");
const runStrip = read("./workflow-run-strip.tsx");
const preview = read("./workflow-manifest-preview.tsx");
const css = read("../../styles/workflows.css");

assert.match(studio, /export function WorkflowStudio/, "Studio composition exists");
assert.match(studio, /WorkflowLibrary/, "Studio includes workflow library");
assert.match(studio, /WorkflowCanvas/, "Studio includes graph canvas");
assert.match(studio, /WorkflowInspector/, "Studio includes inspector");
assert.match(studio, /WorkflowAttachments/, "Studio includes attachments panel");
assert.match(studio, /WorkflowRunStrip/, "Studio includes run strip");
assert.match(studio, /WorkflowManifestPreview/, "Studio includes manifest preview");
assert.match(canvas, /@xyflow\/react/, "Canvas uses React Flow for graph rendering");
assert.match(canvas, /nodeTypes/, "Canvas defines custom workflow node rendering");
assert.match(library, /validation_state/, "Library surfaces validation state");
assert.match(inspector, /Selected node/, "Inspector has selected-node detail state");
assert.match(attachments, /Familiars[\s\S]*Roles[\s\S]*Boards[\s\S]*Projects/, "Attachments cover all target kinds");
assert.match(runStrip, /Validate[\s\S]*Dry-run[\s\S]*Play/, "Run strip exposes validate, dry-run, and guarded play");
assert.match(preview, /schema_version|WORKFLOW\.md|workflow\.yaml/, "Manifest preview names canonical workflow formats");
assert.match(css, /\.workflow-studio-shell/, "Workflow Studio CSS shell exists");
assert.match(css, /@media \(max-width: 860px\)/, "Workflow Studio has a narrow-screen layout");

console.log("workflow-studio.test.ts: ok");
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --experimental-strip-types src/components/workflows/workflow-studio.test.ts
```

Expected: FAIL because the component files do not exist.

- [ ] **Step 3: Implement shared component props**

Create `src/components/workflows/workflow-studio.tsx` with these exported props:

```tsx
"use client";

import type { WorkflowDryRunPlan, WorkflowSummary, WorkflowValidationResult } from "@/lib/workflows";
import type { WorkflowGraphNode } from "@/lib/workflow-graph";
import { WorkflowAttachments } from "./workflow-attachments";
import { WorkflowCanvas } from "./workflow-canvas";
import { WorkflowInspector } from "./workflow-inspector";
import { WorkflowLibrary } from "./workflow-library";
import { WorkflowManifestPreview } from "./workflow-manifest-preview";
import { WorkflowRunStrip } from "./workflow-run-strip";

export type WorkflowStudioActionState = {
  id: string;
  kind: "validate" | "dry-run";
  result: WorkflowValidationResult | WorkflowDryRunPlan;
};

export type WorkflowStudioProps = {
  workflows: WorkflowSummary[];
  selectedWorkflow: WorkflowSummary | null;
  selectedNode: WorkflowGraphNode | null;
  action: WorkflowStudioActionState | null;
  busyId: string | null;
  loaded: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelectWorkflow: (id: string) => void;
  onSelectNode: (id: string | null) => void;
  onValidate: (workflow: WorkflowSummary) => void;
  onDryRun: (workflow: WorkflowSummary) => void;
};

export function WorkflowStudio(props: WorkflowStudioProps) {
  const dryRun = props.action?.kind === "dry-run" ? props.action.result as WorkflowDryRunPlan : null;

  return (
    <section className="workflow-studio-shell" aria-label="Workflow Studio">
      <WorkflowLibrary
        workflows={props.workflows}
        selectedId={props.selectedWorkflow?.id ?? null}
        loaded={props.loaded}
        refreshing={props.refreshing}
        error={props.error}
        onRefresh={props.onRefresh}
        onSelectWorkflow={props.onSelectWorkflow}
      />
      <main className="workflow-studio-main">
        <WorkflowCanvas
          workflow={props.selectedWorkflow}
          dryRun={dryRun}
          selectedNodeId={props.selectedNode?.id ?? null}
          onSelectNode={props.onSelectNode}
        />
        <WorkflowRunStrip
          workflow={props.selectedWorkflow}
          action={props.action}
          busyId={props.busyId}
          onValidate={props.onValidate}
          onDryRun={props.onDryRun}
        />
      </main>
      <aside className="workflow-studio-side" aria-label="Workflow details">
        <WorkflowInspector workflow={props.selectedWorkflow} node={props.selectedNode} action={props.action} />
        <WorkflowAttachments workflow={props.selectedWorkflow} />
        <WorkflowManifestPreview workflow={props.selectedWorkflow} />
      </aside>
    </section>
  );
}
```

- [ ] **Step 4: Implement child components**

Create each child with focused responsibilities:

```tsx
// workflow-library.tsx
"use client";

import { Icon } from "@/lib/icon";
import type { WorkflowSummary } from "@/lib/workflows";

export function WorkflowLibrary({
  workflows,
  selectedId,
  loaded,
  refreshing,
  error,
  onRefresh,
  onSelectWorkflow,
}: {
  workflows: WorkflowSummary[];
  selectedId: string | null;
  loaded: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelectWorkflow: (id: string) => void;
}) {
  return (
    <aside className="workflow-library" aria-label="Workflow library">
      <div className="workflow-panel-header">
        <div>
          <h2>Workflows</h2>
          <p>{loaded ? `${workflows.length} discovered` : "Discovering manifests"}</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={refreshing} className="workflow-icon-button" aria-label="Refresh workflows">
          <Icon name="ph:arrows-clockwise-bold" width={14} className={refreshing ? "animate-spin" : undefined} />
        </button>
      </div>
      {error ? <div className="workflow-error" role="alert">{error}</div> : null}
      <div className="workflow-library-list">
        {!loaded ? <div className="workflow-loading-row" /> : null}
        {loaded && workflows.length === 0 ? <div className="workflow-empty">No workflow manifests found.</div> : null}
        {workflows.map((workflow) => (
          <button
            key={`${workflow.id}:${workflow.path ?? ""}`}
            type="button"
            className={`workflow-library-item${workflow.id === selectedId ? " workflow-library-item--active" : ""}`}
            onClick={() => onSelectWorkflow(workflow.id)}
          >
            <span className="workflow-library-title">{workflow.name ?? workflow.id}</span>
            <span className={`workflow-health workflow-health--${workflow.validation_state ?? "unknown"}`}>
              {workflow.validation_state ?? "unknown"}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
```

Create the remaining files with these visible class/function markers so tests can verify the shell:

```tsx
// workflow-canvas.tsx
"use client";

import { Background, Controls, MiniMap, ReactFlow, type Node, type Edge } from "@xyflow/react";
import type { WorkflowDryRunPlan, WorkflowSummary } from "@/lib/workflows";
import { workflowToGraph, type WorkflowGraphNodeData } from "@/lib/workflow-graph";

function WorkflowStepNode({ data }: { data: WorkflowGraphNodeData }) {
  return (
    <div className={`workflow-node workflow-node--${data.tone}`}>
      <div className="workflow-node-kind">{data.kind}</div>
      <div className="workflow-node-label">{data.label}</div>
      {data.uses ? <div className="workflow-node-uses">{data.uses}</div> : null}
    </div>
  );
}

const nodeTypes = { workflowStep: WorkflowStepNode };

export function WorkflowCanvas({
  workflow,
  dryRun,
  selectedNodeId,
  onSelectNode,
}: {
  workflow: WorkflowSummary | null;
  dryRun: WorkflowDryRunPlan | null;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const graph = workflow ? workflowToGraph(workflow, dryRun) : { nodes: [], edges: [] };
  const nodes: Node<WorkflowGraphNodeData>[] = graph.nodes.map((node) => ({
    ...node,
    selected: node.id === selectedNodeId,
  }));
  const edges: Edge[] = graph.edges;

  return (
    <section className="workflow-canvas" aria-label="Workflow graph canvas">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView onNodeClick={(_, node) => onSelectNode(node.id)} onPaneClick={() => onSelectNode(null)}>
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </section>
  );
}
```

Create `workflow-inspector.tsx`:

```tsx
"use client";

import { workflowIssueSummary, type WorkflowSummary } from "@/lib/workflows";
import type { WorkflowGraphNode } from "@/lib/workflow-graph";
import type { WorkflowStudioActionState } from "./workflow-studio";

function actionIssues(action: WorkflowStudioActionState | null): string {
  if (!action) return "Validation has not run for this workflow.";
  const issues = "issues" in action.result ? action.result.issues ?? [] : [];
  if (action.result.error) return action.result.error;
  return workflowIssueSummary(issues);
}

export function WorkflowInspector({
  workflow,
  node,
  action,
}: {
  workflow: WorkflowSummary | null;
  node: WorkflowGraphNode | null;
  action: WorkflowStudioActionState | null;
}) {
  return (
    <section className="workflow-inspector" aria-label="Workflow inspector">
      <div className="workflow-panel-header">
        <div>
          <h3>Selected node</h3>
          <p>{node ? node.data.label : "Workflow"}</p>
        </div>
      </div>
      <dl className="workflow-detail-list">
        <div><dt>Kind</dt><dd>{node?.data.kind ?? workflow?.pattern ?? "workflow"}</dd></div>
        <div><dt>Uses</dt><dd>{node?.data.uses ?? workflow?.familiar ?? "Not specified"}</dd></div>
        <div><dt>Permissions</dt><dd>{workflow?.permissions?.join(", ") ?? "No permissions declared"}</dd></div>
        <div><dt>Validation</dt><dd>{actionIssues(action)}</dd></div>
      </dl>
    </section>
  );
}
```

Create `workflow-attachments.tsx`:

```tsx
"use client";

import type { WorkflowSummary } from "@/lib/workflows";

const ATTACH_TARGETS = ["Familiars", "Roles", "Boards", "Projects"] as const;

export function WorkflowAttachments({ workflow }: { workflow: WorkflowSummary | null }) {
  return (
    <section className="workflow-attachments" aria-label="Workflow attachments">
      <div className="workflow-panel-header">
        <div>
          <h3>Attach to</h3>
          <p>{workflow ? workflow.id : "Select a workflow"}</p>
        </div>
      </div>
      <div className="workflow-attachment-grid">
        {ATTACH_TARGETS.map((target) => (
          <div key={target} className="workflow-attachment-target">
            <span>{target}</span>
            <button type="button" disabled className="workflow-attach-save">
              Persistence pending daemon API
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
```

Create `workflow-run-strip.tsx`:

```tsx
"use client";

import { Icon } from "@/lib/icon";
import { workflowIssueSummary, type WorkflowSummary } from "@/lib/workflows";
import type { WorkflowStudioActionState } from "./workflow-studio";

function actionSummary(action: WorkflowStudioActionState | null): string {
  if (!action) return "Validate or dry-run to preview execution.";
  const issues = "issues" in action.result ? action.result.issues ?? [] : [];
  if (action.result.error) return action.result.error;
  return workflowIssueSummary(issues);
}

export function WorkflowRunStrip({
  workflow,
  action,
  busyId,
  onValidate,
  onDryRun,
}: {
  workflow: WorkflowSummary | null;
  action: WorkflowStudioActionState | null;
  busyId: string | null;
  onValidate: (workflow: WorkflowSummary) => void;
  onDryRun: (workflow: WorkflowSummary) => void;
}) {
  const disabled = !workflow || busyId !== null;
  return (
    <section className="workflow-run-strip" aria-label="Workflow run controls">
      <div className="workflow-run-actions">
        <button type="button" disabled={disabled} onClick={() => workflow && onValidate(workflow)} className="workflow-run-button">
          <Icon name="ph:check-circle-bold" width={14} />
          <span>Validate</span>
        </button>
        <button type="button" disabled={disabled} onClick={() => workflow && onDryRun(workflow)} className="workflow-run-button">
          <Icon name="ph:rocket-bold" width={14} />
          <span>Dry-run</span>
        </button>
        <button type="button" className="workflow-run-button workflow-run-button--play" disabled title="Run endpoint pending">
          <Icon name="ph:play-bold" width={14} />
          <span>Play</span>
        </button>
      </div>
      <div className="workflow-run-status">
        <span>{actionSummary(action)}</span>
        <span className="workflow-run-hint">Run endpoint pending</span>
      </div>
    </section>
  );
}
```

Create `workflow-manifest-preview.tsx`:

```tsx
"use client";

import type { WorkflowSummary } from "@/lib/workflows";

export function WorkflowManifestPreview({ workflow }: { workflow: WorkflowSummary | null }) {
  const lines = workflow ? [
    "schema_version: coven.workflow.v1",
    `id: ${workflow.id}`,
    `version: ${workflow.version}`,
    `pattern: ${workflow.pattern ?? "sequential"}`,
    `familiar: ${workflow.familiar ?? "unassigned"}`,
    `limits.max_agents: ${workflow.limits?.max_agents ?? "required"}`,
    `steps: ${workflow.steps?.length ?? 0}`,
  ] : ["Select a workflow to preview WORKFLOW.md / .workflow.yaml"];

  return (
    <section className="workflow-manifest-preview" aria-label="Workflow manifest preview">
      <div className="workflow-panel-header">
        <div>
          <h3>WORKFLOW.md / .workflow.yaml</h3>
          <p>Canonical manifest preview</p>
        </div>
      </div>
      <pre>{lines.join("\n")}</pre>
      <p className="workflow-sidecar-note">Cave-only layout stays in WORKFLOW.cave.json.</p>
    </section>
  );
}
```

- [ ] **Step 5: Add Studio CSS**

Create `src/styles/workflows.css` with the shell markers and responsive layout:

```css
.workflow-studio-shell {
  display: grid;
  grid-template-columns: 260px minmax(420px, 1fr) 320px;
  height: 100%;
  min-height: 0;
  background: var(--bg-base);
  color: var(--text-primary);
}

.workflow-library,
.workflow-studio-side,
.workflow-run-strip,
.workflow-manifest-preview,
.workflow-inspector,
.workflow-attachments {
  border-color: var(--border-hairline);
  background: color-mix(in oklch, var(--bg-raised) 82%, transparent);
}

.workflow-studio-main {
  display: grid;
  grid-template-rows: minmax(320px, 1fr) auto;
  min-width: 0;
  min-height: 0;
}

.workflow-canvas {
  min-height: 0;
  background:
    radial-gradient(circle at 20% 10%, color-mix(in oklch, var(--color-danger) 18%, transparent), transparent 32%),
    linear-gradient(135deg, var(--bg-panel), var(--bg-base));
}

.workflow-node {
  min-width: 150px;
  max-width: 190px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--bg-raised);
  box-shadow: 0 18px 40px rgb(0 0 0 / 24%);
}

.workflow-node--agent { border-color: color-mix(in oklch, var(--color-info) 58%, transparent); }
.workflow-node--tool { border-color: color-mix(in oklch, var(--color-success) 58%, transparent); }
.workflow-node--gate { border-color: color-mix(in oklch, var(--color-warning) 58%, transparent); }
.workflow-node--workflow { border-color: color-mix(in oklch, var(--accent-presence) 58%, transparent); }
.workflow-node--output { border-color: color-mix(in oklch, var(--color-danger) 58%, transparent); }

@media (max-width: 860px) {
  .workflow-studio-shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(360px, 1fr) auto;
  }

  .workflow-studio-side {
    display: grid;
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 6: Wire the new source test into `test:app`**

Modify `package.json` so `src/components/workflows/workflow-studio.test.ts` runs immediately after `src/components/workflows-view.test.ts`.

- [ ] **Step 7: Run component tests**

Run:

```bash
node --experimental-strip-types src/components/workflows/workflow-studio.test.ts
pnpm run test:app
```

Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add package.json src/app/globals.css src/components/workflows src/styles/workflows.css
git commit -m "feat: add Workflow Studio shell"
```

---

### Task 4: Integrate Studio Into Workflows View

**Files:**
- Modify: `src/components/workflows-view.tsx`
- Modify: `src/components/workflows-view.test.ts`

- [ ] **Step 1: Upgrade the source test**

Replace `src/components/workflows-view.test.ts` with assertions for the Studio container:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./workflows-view.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/workflows.ts", import.meta.url), "utf8");

assert.match(source, /export function WorkflowsView/, "Cave should expose a first-class Workflows view");
assert.match(source, /WorkflowStudio/, "Workflows view should render the Studio composition");
assert.match(source, /selectedWorkflowId/, "Workflows view should track selected workflow");
assert.match(source, /selectedNodeId/, "Workflows view should track selected graph node");
assert.match(source, /listWorkflows/, "Workflows view should load manifests through the Cave workflow client");
assert.match(client, /\/api\/workflows/, "Workflows view should stay behind Cave API proxy routes");
assert.match(source, /validateWorkflow/, "Workflows view should wire validation");
assert.match(source, /dryRunWorkflow/, "Workflows view should wire dry-run preview");
assert.match(source, /workflowToGraph/, "Workflows view should derive graph selection from manifest data");

console.log("workflows-view.test.ts: ok");
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --experimental-strip-types src/components/workflows-view.test.ts
```

Expected: FAIL until the component imports and renders `WorkflowStudio`.

- [ ] **Step 3: Replace the old row UI with the Studio container**

Update `src/components/workflows-view.tsx` so it imports `WorkflowStudio`, `workflowToGraph`, and tracks selection:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkflowStudio, type WorkflowStudioActionState } from "@/components/workflows/workflow-studio";
import { workflowToGraph } from "@/lib/workflow-graph";
```

Keep the existing `load`, `runValidate`, and `runDryRun` behavior. Add:

```tsx
const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

useEffect(() => {
  if (workflows.length === 0) {
    setSelectedWorkflowId(null);
    setSelectedNodeId(null);
    return;
  }
  setSelectedWorkflowId((current) =>
    current && workflows.some((workflow) => workflow.id === current)
      ? current
      : workflows[0].id,
  );
}, [workflows]);

const selectedWorkflow = useMemo(
  () => workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
  [selectedWorkflowId, workflows],
);

const selectedNode = useMemo(() => {
  if (!selectedWorkflow || !selectedNodeId) return null;
  return workflowToGraph(selectedWorkflow, action?.kind === "dry-run" ? action.result : null)
    .nodes.find((node) => node.id === selectedNodeId) ?? null;
}, [action, selectedNodeId, selectedWorkflow]);
```

Render:

```tsx
return (
  <div className="flex h-full min-w-0 flex-col bg-background text-foreground">
    <WorkflowStudio
      workflows={workflows}
      selectedWorkflow={selectedWorkflow}
      selectedNode={selectedNode}
      action={selectedWorkflow && action?.id === selectedWorkflow.id ? action : null}
      busyId={busyId}
      loaded={loaded}
      refreshing={refreshing}
      error={error}
      onRefresh={() => void load(true)}
      onSelectWorkflow={(id) => {
        setSelectedWorkflowId(id);
        setSelectedNodeId(null);
      }}
      onSelectNode={setSelectedNodeId}
      onValidate={(workflow) => void runValidate(workflow)}
      onDryRun={(workflow) => void runDryRun(workflow)}
    />
  </div>
);
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --experimental-strip-types src/components/workflows-view.test.ts
node --experimental-strip-types src/components/workflows/workflow-studio.test.ts
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/workflows-view.tsx src/components/workflows-view.test.ts
git commit -m "feat: render Workflow Studio in Cave"
```

---

### Task 5: Polish Run States And Guardrails

**Files:**
- Modify: `src/components/workflows/workflow-run-strip.tsx`
- Modify: `src/components/workflows/workflow-inspector.tsx`
- Modify: `src/components/workflows/workflow-attachments.tsx`
- Modify: `src/components/workflows/workflow-manifest-preview.tsx`
- Modify: `src/components/workflows/workflow-studio.test.ts`

- [ ] **Step 1: Add source test assertions for guardrails**

Add to `src/components/workflows/workflow-studio.test.ts`:

```ts
assert.match(runStrip, /Run endpoint pending/, "Play is guarded until daemon execution exists");
assert.match(runStrip, /workflowIssueSummary/, "Run strip summarizes validator and dry-run issues");
assert.match(attachments, /Persistence pending daemon API/, "Attachment saves are visibly non-destructive in PR 1");
assert.match(preview, /Cave-only layout stays in WORKFLOW\.cave\.json/, "Manifest preview keeps sidecar boundary visible");
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --experimental-strip-types src/components/workflows/workflow-studio.test.ts
```

Expected: FAIL until the guardrail strings and summaries exist.

- [ ] **Step 3: Implement issue summaries and guarded play**

In `workflow-run-strip.tsx`, import `workflowIssueSummary` and render action feedback:

```tsx
import { Icon } from "@/lib/icon";
import { workflowIssueSummary, type WorkflowDryRunPlan, type WorkflowSummary, type WorkflowValidationResult } from "@/lib/workflows";
import type { WorkflowStudioActionState } from "./workflow-studio";

function actionSummary(action: WorkflowStudioActionState | null): string {
  if (!action) return "Validate or dry-run to preview execution.";
  const issues = "issues" in action.result ? action.result.issues ?? [] : [];
  if (action.result.error) return action.result.error;
  return workflowIssueSummary(issues);
}
```

Keep the Play button disabled:

```tsx
<button type="button" className="workflow-run-button workflow-run-button--play" disabled title="Run endpoint pending">
  <Icon name="ph:play-bold" width={14} />
  <span>Play</span>
</button>
<span className="workflow-run-hint">Run endpoint pending</span>
```

- [ ] **Step 4: Keep attachment saves non-destructive**

In `workflow-attachments.tsx`, every attachment group should render a disabled save button:

```tsx
<button type="button" disabled className="workflow-attach-save">
  Persistence pending daemon API
</button>
```

- [ ] **Step 5: Add sidecar boundary to manifest preview**

In `workflow-manifest-preview.tsx`, include:

```tsx
<p className="workflow-sidecar-note">Cave-only layout stays in WORKFLOW.cave.json.</p>
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --experimental-strip-types src/components/workflows/workflow-studio.test.ts
pnpm run test:app
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/workflows
git commit -m "feat: add workflow run guardrails"
```

---

### Task 6: Final Verification And Tracking

**Files:**
- Modify outside git: `~/.coven/cave-board.json`

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm exec tsc --noEmit
pnpm run test:app
pnpm run test:api
```

Expected: all pass.

- [ ] **Step 2: Inspect final diff**

Run:

```bash
git status -sb
git diff --stat origin/main..HEAD
git diff --check origin/main..HEAD
```

Expected: clean worktree, expected files only, no whitespace errors.

- [ ] **Step 3: Update Cave Board card**

Update card `810f21eb-6563-45b4-87b9-4f96766d4b07` in `~/.coven/cave-board.json`:

- Add the implementation plan path: `docs/superpowers/plans/2026-06-11-cave-workflow-studio-foundation.md`
- Add the eventual PR URL after the branch is pushed and a PR exists.
- Keep status `running` until PR 1 is merged.

- [ ] **Step 4: Commit verification note if docs changed**

If verification notes are added to tracked docs, commit them:

```bash
git add docs/superpowers/plans/2026-06-11-cave-workflow-studio-foundation.md
git commit -m "docs: record workflow studio verification"
```

- [ ] **Step 5: Push and open PR after approval**

Run only after Val approves execution completion:

```bash
git push -u origin codex/cave-workflow-studio-foundation
```

Open a PR titled:

```text
feat(workflows): add Cave Workflow Studio foundation
```

PR body must link:

- Design spec: `docs/superpowers/specs/2026-06-11-cave-workflow-studio-design.md`
- Plan: `docs/superpowers/plans/2026-06-11-cave-workflow-studio-foundation.md`
- Cave Board card: `810f21eb-6563-45b4-87b9-4f96766d4b07`

---

## Self-Review Checklist

- Every PR 1 design requirement maps to a task.
- Canonical manifests remain the source of truth.
- Cave-only layout remains sidecar-bound.
- Attachment persistence stays disabled until API support exists.
- Play is guarded until daemon execution exists.
- Tests cover graph conversion, Studio component regions, Workflows view integration, and guardrail strings.
- The plan avoids app implementation before execution begins.
