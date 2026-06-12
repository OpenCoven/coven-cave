import type { WorkflowStepKind, WorkflowStepSummary, WorkflowSummary } from "./workflows.ts";

/**
 * Pure editing state machine for the Workflow Studio builder. The draft is a
 * deep copy of a `WorkflowSummary`; every mutation snapshots the previous
 * draft for undo. Invalid edits (id collisions, duplicate/self/cyclic
 * connections) return the input state unchanged so callers can treat
 * referential equality as "rejected".
 */

const HISTORY_CAP = 50;

export type WorkflowDraftState = {
  draft: WorkflowSummary;
  past: WorkflowSummary[];
  future: WorkflowSummary[];
  dirty: boolean;
};

export type WorkflowDraftAction =
  | { type: "reset"; workflow: WorkflowSummary }
  | { type: "update-meta"; patch: Partial<WorkflowSummary> }
  | { type: "add-step"; kind: WorkflowStepKind }
  | { type: "update-step"; id: string; patch: Partial<WorkflowStepSummary> }
  | { type: "remove-step"; id: string }
  | { type: "connect"; source: string; target: string }
  | { type: "disconnect"; source: string; target: string }
  | { type: "undo" }
  | { type: "redo" };

export function initialWorkflowDraft(workflow: WorkflowSummary): WorkflowDraftState {
  return { draft: structuredClone(workflow), past: [], future: [], dirty: false };
}

/** True if making `target` depend on `source` would close a requires-cycle. */
export function wouldCreateCycle(steps: WorkflowStepSummary[], source: string, target: string): boolean {
  // A cycle forms iff target is already (transitively) required by source.
  const requiresOf = new Map(steps.map((step) => [step.id, step.requires ?? []]));
  const seen = new Set<string>();
  const stack = [source];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(requiresOf.get(current) ?? []));
  }
  return false;
}

function nextStepId(steps: WorkflowStepSummary[]): string {
  const taken = new Set(steps.map((step) => step.id));
  let n = steps.length + 1;
  while (taken.has(`step-${n}`)) n += 1;
  return `step-${n}`;
}

function commit(state: WorkflowDraftState, draft: WorkflowSummary): WorkflowDraftState {
  const past = [...state.past, state.draft];
  if (past.length > HISTORY_CAP) past.shift();
  return { draft, past, future: [], dirty: true };
}

export function workflowDraftReducer(
  state: WorkflowDraftState,
  action: WorkflowDraftAction,
): WorkflowDraftState {
  switch (action.type) {
    case "reset":
      return initialWorkflowDraft(action.workflow);

    case "update-meta": {
      return commit(state, { ...structuredClone(state.draft), ...structuredClone(action.patch) });
    }

    case "add-step": {
      const draft = structuredClone(state.draft);
      const steps = draft.steps ?? [];
      const id = nextStepId(steps);
      steps.push({ id, kind: action.kind, name: id });
      draft.steps = steps;
      return commit(state, draft);
    }

    case "update-step": {
      const steps = state.draft.steps ?? [];
      const index = steps.findIndex((step) => step.id === action.id);
      if (index === -1) return state;
      const nextId = action.patch.id;
      if (nextId !== undefined && nextId !== action.id) {
        if (nextId.length === 0 || steps.some((step) => step.id === nextId)) return state;
      }
      const draft = structuredClone(state.draft);
      const draftSteps = draft.steps!;
      draftSteps[index] = { ...draftSteps[index], ...structuredClone(action.patch) };
      if (nextId !== undefined && nextId !== action.id) {
        for (const step of draftSteps) {
          if (step.requires?.includes(action.id)) {
            step.requires = step.requires.map((dep) => (dep === action.id ? nextId : dep));
          }
        }
      }
      return commit(state, draft);
    }

    case "remove-step": {
      const steps = state.draft.steps ?? [];
      if (!steps.some((step) => step.id === action.id)) return state;
      const draft = structuredClone(state.draft);
      draft.steps = (draft.steps ?? [])
        .filter((step) => step.id !== action.id)
        .map((step) => {
          if (!step.requires?.includes(action.id)) return step;
          const requires = step.requires.filter((dep) => dep !== action.id);
          return { ...step, requires: requires.length > 0 ? requires : undefined };
        });
      return commit(state, draft);
    }

    case "connect": {
      const steps = state.draft.steps ?? [];
      if (action.source === action.target) return state;
      const target = steps.find((step) => step.id === action.target);
      const source = steps.find((step) => step.id === action.source);
      if (!target || !source) return state;
      if (target.requires?.includes(action.source)) return state;
      if (wouldCreateCycle(steps, action.source, action.target)) return state;
      const draft = structuredClone(state.draft);
      const draftTarget = draft.steps!.find((step) => step.id === action.target)!;
      draftTarget.requires = [...(draftTarget.requires ?? []), action.source];
      return commit(state, draft);
    }

    case "disconnect": {
      const steps = state.draft.steps ?? [];
      const target = steps.find((step) => step.id === action.target);
      if (!target?.requires?.includes(action.source)) return state;
      const draft = structuredClone(state.draft);
      const draftTarget = draft.steps!.find((step) => step.id === action.target)!;
      const requires = (draftTarget.requires ?? []).filter((dep) => dep !== action.source);
      draftTarget.requires = requires.length > 0 ? requires : undefined;
      return commit(state, draft);
    }

    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        draft: previous,
        past: state.past.slice(0, -1),
        future: [state.draft, ...state.future],
        dirty: true,
      };
    }

    case "redo": {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return {
        draft: next,
        past: [...state.past, state.draft],
        future: rest,
        dirty: true,
      };
    }

    default:
      return state;
  }
}
