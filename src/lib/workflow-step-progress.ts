/**
 * Derive live per-step progress for a workflow run from the executing agent's
 * transcript.
 *
 * A Cave workflow run is a single agent session carrying out a compiled
 * step-plan prompt (see `workflow-run-prompt.ts`); there is no server-side step
 * engine emitting telemetry. To surface "which step are we on, and what is the
 * agent doing", the run prompt asks the agent to print a marker line as it
 * enters and leaves each step:
 *
 *   @@step-start <id>
 *   …the agent's work / reasoning / output for that step…
 *   @@step-done <id>      (or @@step-fail <id>)
 *
 * This pure parser maps that transcript back onto the manifest's ordered steps,
 * capturing the text between a step's start marker and the next marker as that
 * step's debug detail. It's deliberately tolerant: a step that started and was
 * superseded by a later start is treated as implicitly succeeded, and a run
 * whose agent emitted no markers at all reports `markersFound: false` so the UI
 * can fall back to showing the raw transcript.
 */

export type WorkflowStepProgressStatus = "pending" | "active" | "succeeded" | "failed";

export type WorkflowStepProgress = {
  id: string;
  status: WorkflowStepProgressStatus;
  /** Agent narration captured while this step was active — the debug detail. */
  detail: string;
};

export type WorkflowStepProgressResult = {
  steps: WorkflowStepProgress[];
  /** The step currently being worked (last start without a matching done/fail), or null. */
  activeStepId: string | null;
  /** True once every step has resolved to succeeded/failed (none pending/active). */
  done: boolean;
  /** False when the agent emitted no recognizable step markers at all. */
  markersFound: boolean;
};

type Marker = { kind: "start" | "done" | "fail"; id: string; at: number; end: number };

const MARKER_RE = /^[ \t]*@@step-(start|done|fail)[ \t]+(\S+)[ \t]*$/gim;
const MAX_DETAIL = 4000;

/** Extract every step marker in source order. */
function findMarkers(transcript: string): Marker[] {
  const markers: Marker[] = [];
  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(transcript)) !== null) {
    markers.push({ kind: m[1] as Marker["kind"], id: m[2], at: m.index, end: m.index + m[0].length });
  }
  return markers;
}

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_DETAIL ? `${trimmed.slice(0, MAX_DETAIL)}\n…` : trimmed;
}

/**
 * @param transcript  Flattened assistant output for the run's session.
 * @param orderedStepIds  Manifest step ids in execution order.
 */
export function parseWorkflowStepProgress(
  transcript: string,
  orderedStepIds: string[],
): WorkflowStepProgressResult {
  const markers = findMarkers(transcript ?? "");
  const known = new Set(orderedStepIds);
  // Only trust markers that name a real step (guards against the agent echoing
  // the instruction text or inventing ids).
  const real = markers.filter((mk) => known.has(mk.id));

  const status = new Map<string, WorkflowStepProgressStatus>();
  const detail = new Map<string, string>();
  for (const id of orderedStepIds) status.set(id, "pending");

  // Resolve explicit terminal verdicts first.
  for (const mk of real) {
    if (mk.kind === "done") status.set(mk.id, "succeeded");
    else if (mk.kind === "fail") status.set(mk.id, "failed");
  }

  // The active step is the LAST start that has no later done/fail for the same id.
  let activeStepId: string | null = null;
  for (let i = real.length - 1; i >= 0; i--) {
    const mk = real[i];
    if (mk.kind !== "start") continue;
    const resolvedLater = real
      .slice(i + 1)
      .some((n) => n.id === mk.id && (n.kind === "done" || n.kind === "fail"));
    if (!resolvedLater) {
      if (status.get(mk.id) === "pending") {
        status.set(mk.id, "active");
        activeStepId = mk.id;
      }
      break;
    }
  }

  // A step that started but was superseded by a later marker (and never got an
  // explicit done/fail) is implicitly succeeded — the agent moved on.
  for (const mk of real) {
    if (mk.kind === "start" && status.get(mk.id) === "pending") {
      status.set(mk.id, "succeeded");
    }
  }

  // Capture each start's detail = text up to the next marker of any step.
  for (let i = 0; i < real.length; i++) {
    const mk = real[i];
    if (mk.kind !== "start") continue;
    const next = real[i + 1]?.at ?? transcript.length;
    const slice = clip(transcript.slice(mk.end, next));
    if (slice) detail.set(mk.id, slice);
  }

  const steps: WorkflowStepProgress[] = orderedStepIds.map((id) => ({
    id,
    status: status.get(id) ?? "pending",
    detail: detail.get(id) ?? "",
  }));

  const done = steps.length > 0 && steps.every((s) => s.status === "succeeded" || s.status === "failed");

  return { steps, activeStepId, done, markersFound: real.length > 0 };
}
