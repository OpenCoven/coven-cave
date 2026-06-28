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
 *   @@step-note <id> <one-line summary of what the step produced>   (optional)
 *   @@step-done <id>      (or @@step-fail <id>)
 *
 * This pure parser maps that transcript back onto the manifest's ordered steps,
 * capturing the text between a step's start marker and the next marker as that
 * step's debug detail (with marker lines scrubbed out), plus the optional
 * one-line `@@step-note` as a clean per-step headline. It's deliberately tolerant: a step that started and was
 * superseded by a later start is treated as implicitly succeeded, and a run
 * whose agent emitted no markers at all reports `markersFound: false` so the UI
 * can fall back to showing the raw transcript.
 */

export type WorkflowStepProgressStatus = "pending" | "active" | "succeeded" | "failed";

export type WorkflowStepProgress = {
  id: string;
  status: WorkflowStepProgressStatus;
  /** Agent narration captured while this step was active — the debug detail.
   *  Step-marker lines (including `@@step-note`) are stripped so it reads as
   *  clean prose. */
  detail: string;
  /** One-line summary the agent emitted via `@@step-note <id> <text>` — a clean
   *  headline for the step, distinct from the fuller `detail` body. Last note
   *  for a step wins; undefined when the agent emitted none. */
  note?: string;
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
// A per-step summary line: `@@step-note <id> <free text>`. Kept separate from
// MARKER_RE so the trailing free text doesn't break the strict start/done/fail
// shape, and so notes never act as step boundaries.
const NOTE_RE = /^[ \t]*@@step-note[ \t]+(\S+)[ \t]+(.+?)[ \t]*$/gim;
// Any step-marker line (start/done/fail/note) — used to scrub markers out of the
// human-facing detail/transcript text.
const ANY_MARKER_LINE_RE = /^[ \t]*@@step-(?:start|done|fail|note)\b.*$/gim;
const MAX_DETAIL = 4000;
const MAX_NOTE = 240;

/** Extract every start/done/fail marker in source order. */
function findMarkers(transcript: string): Marker[] {
  const markers: Marker[] = [];
  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(transcript)) !== null) {
    markers.push({ kind: m[1] as Marker["kind"], id: m[2], at: m.index, end: m.index + m[0].length });
  }
  return markers;
}

/** Extract every `@@step-note` as {id, text} in source order. */
function findNotes(transcript: string): Array<{ id: string; text: string }> {
  const notes: Array<{ id: string; text: string }> = [];
  NOTE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NOTE_RE.exec(transcript)) !== null) {
    notes.push({ id: m[1], text: m[2].trim() });
  }
  return notes;
}

/**
 * Remove every step-marker line from agent text so the human-facing log/output
 * reads as clean prose. Collapses the blank lines a stripped marker leaves
 * behind. Exported so the run UI's "Session output" pane and per-step detail
 * share one scrubbing rule.
 */
export function stripStepMarkers(text: string): string {
  return (text ?? "")
    .replace(ANY_MARKER_LINE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clip(text: string): string {
  const trimmed = stripStepMarkers(text);
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

  // Capture each start's detail = text up to the next marker of any step, with
  // step-marker lines scrubbed out (clip() strips them) so the body is prose.
  for (let i = 0; i < real.length; i++) {
    const mk = real[i];
    if (mk.kind !== "start") continue;
    const next = real[i + 1]?.at ?? transcript.length;
    const slice = clip(transcript.slice(mk.end, next));
    if (slice) detail.set(mk.id, slice);
  }

  // Per-step one-line summaries (last note for a step wins). Only honour notes
  // that name a real step, mirroring the marker-id guard above.
  const note = new Map<string, string>();
  for (const n of findNotes(transcript ?? "")) {
    if (!known.has(n.id) || !n.text) continue;
    note.set(n.id, n.text.length > MAX_NOTE ? `${n.text.slice(0, MAX_NOTE)}…` : n.text);
  }

  const steps: WorkflowStepProgress[] = orderedStepIds.map((id) => ({
    id,
    status: status.get(id) ?? "pending",
    detail: detail.get(id) ?? "",
    ...(note.has(id) ? { note: note.get(id) } : {}),
  }));

  const done = steps.length > 0 && steps.every((s) => s.status === "succeeded" || s.status === "failed");

  return { steps, activeStepId, done, markersFound: real.length > 0 };
}
