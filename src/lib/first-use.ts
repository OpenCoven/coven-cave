/** Client-safe methodology progress. No selection in this module grants access. */
export type FirstUseDefaults = {
  projectId: string;
  familiarIds: string[];
  actingFamiliarId: string;
};

export type FirstUseStep = "assistant" | "project" | "outcome" | "context" | "access" | "approval" | "progress" | "verify" | "complete";
export type FirstUseState = {
  version: 1 | 2;
  revision: number;
  step: FirstUseStep;
  outcome: "inspect" | "plan" | null;
  defaults: FirstUseDefaults | null;
  practice: { approvalHeld: boolean; stopped: boolean; retried: boolean; verified: boolean };
  completedAt: string | null;
  permissionMode?: "read" | "full";
  setupFamiliarId?: string | null;
};

export type FirstUseAction =
  | { kind: "choose-assistant"; familiarId: string }
  | { kind: "finish-setup"; defaults: FirstUseDefaults; permissionMode: "read" | "full" }
  | { kind: "outcome"; outcome: "inspect" | "plan" }
  | { kind: "context"; defaults: FirstUseDefaults }
  | { kind: "review-access"; permissionMode?: "read" | "full" }
  | { kind: "hold-approval" }
  | { kind: "approve" }
  | { kind: "stop" }
  | { kind: "retry" }
  | { kind: "verify"; evidence: string };

const STEPS: readonly FirstUseStep[] = ["outcome", "context", "access", "approval", "progress", "verify", "complete"];

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid introduction state");
  return value as Record<string, unknown>;
}

function stableId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value;
}

export function parseFirstUseDefaults(value: unknown): FirstUseDefaults {
  const data = object(value);
  if (!stableId(data.projectId) || !stableId(data.actingFamiliarId)
    || !Array.isArray(data.familiarIds) || data.familiarIds.length === 0 || data.familiarIds.length > 100
    || !data.familiarIds.every(stableId)
    || new Set(data.familiarIds).size !== data.familiarIds.length
    || !data.familiarIds.includes(data.actingFamiliarId)) {
    throw new Error("Choose a project, an explicit familiar scope and one acting familiar in that scope");
  }
  return { projectId: data.projectId, familiarIds: [...data.familiarIds], actingFamiliarId: data.actingFamiliarId };
}

export function createFirstUseState(): FirstUseState {
  return {
    version: 1, revision: 0, step: "outcome", outcome: null, defaults: null,
    practice: { approvalHeld: false, stopped: false, retried: false, verified: false }, completedAt: null, permissionMode: "read",
  };
}

/** Fresh setup records readiness separately from the optional practice guide. */
export function createQuickStartState(): FirstUseState {
  return { ...createFirstUseState(), version: 2, step: "assistant", setupFamiliarId: null };
}

/** Corruption must remain visible; it must never reset trust to broad defaults. */
export function parseFirstUseState(value: unknown): FirstUseState {
  const data = object(value);
  if (data.version !== 1 && data.version !== 2) throw new Error("Unsupported introduction state version");
  const steps = data.version === 2 ? ["assistant", "project", "complete"] : STEPS;
  if (!Number.isSafeInteger(data.revision) || (data.revision as number) < 0
    || !steps.includes(data.step as FirstUseStep)) throw new Error("Invalid introduction progress");
  if (data.outcome !== null && data.outcome !== "inspect" && data.outcome !== "plan") throw new Error("Invalid outcome");
  if (data.permissionMode !== undefined && data.permissionMode !== "read" && data.permissionMode !== "full") throw new Error("Invalid reviewed access mode");
  const defaults = data.defaults === null ? null : parseFirstUseDefaults(data.defaults);
  const practice = object(data.practice);
  for (const key of ["approvalHeld", "stopped", "retried", "verified"] as const) {
    if (typeof practice[key] !== "boolean") throw new Error("Invalid introduction practice");
  }
  const index = STEPS.indexOf(data.step as FirstUseStep);
  if (data.version === 1 && index >= 1 && data.outcome === null) throw new Error("Choose an outcome before continuing");
  if (data.version === 1 && index >= 2 && defaults === null) throw new Error("Choose concrete context before continuing");
  if (data.version === 1 && ((index >= 4 && !practice.approvalHeld) || (index >= 5 && (!practice.stopped || !practice.retried)))) {
    throw new Error("Introduction practice is incomplete");
  }
  if (data.completedAt !== null && (typeof data.completedAt !== "string" || !Number.isFinite(Date.parse(data.completedAt)))) {
    throw new Error("Invalid introduction completion date");
  }
  if ((data.step === "complete") !== Boolean(data.completedAt) || (data.version === 1 && (data.step === "complete") !== practice.verified)) {
    throw new Error("Introduction completion requires verified practice");
  }
  if (data.version === 2) {
    if (data.setupFamiliarId !== null && !stableId(data.setupFamiliarId)) throw new Error("Choose a familiar before continuing");
    if (data.step !== "assistant" && !stableId(data.setupFamiliarId)) throw new Error("Choose a familiar before continuing");
    if (data.step === "complete" && (!defaults || defaults.actingFamiliarId !== data.setupFamiliarId || (data.permissionMode !== "read" && data.permissionMode !== "full"))) {
      throw new Error("Setup completion requires concrete context and reviewed access");
    }
  }
  return {
    version: data.version, revision: data.revision as number, step: data.step as FirstUseStep,
    ...(data.version === 2 ? { setupFamiliarId: data.setupFamiliarId as string | null } : {}),
    outcome: data.outcome, defaults, permissionMode: data.permissionMode === "full" ? "full" : "read",
    practice: {
      approvalHeld: practice.approvalHeld as boolean, stopped: practice.stopped as boolean,
      retried: practice.retried as boolean, verified: practice.verified as boolean,
    }, completedAt: data.completedAt as string | null,
  };
}

export function advanceFirstUse(state: FirstUseState, action: FirstUseAction, now = new Date().toISOString()): FirstUseState {
  const next = parseFirstUseState(state);
  if (action.kind === "choose-assistant") {
    if (!stableId(action.familiarId)) throw new Error("Choose a familiar");
    return parseFirstUseState({ ...next, version: 2, revision: next.revision + 1, step: "project", setupFamiliarId: action.familiarId, completedAt: null });
  }
  if (action.kind === "finish-setup") {
    const defaults = parseFirstUseDefaults(action.defaults);
    const actor = next.version === 2 ? next.setupFamiliarId : next.defaults?.actingFamiliarId;
    if (actor !== defaults.actingFamiliarId) throw new Error("Review the selected acting familiar before continuing");
    if (action.permissionMode !== "read" && action.permissionMode !== "full") throw new Error("Choose Read or Full access");
    return parseFirstUseState({ ...next, version: 2, revision: next.revision + 1, step: "complete", setupFamiliarId: actor, defaults, permissionMode: action.permissionMode, completedAt: now });
  }
  if (next.version === 2) throw new Error("Use the short setup actions to configure this workspace");
  const requireStep = (step: FirstUseStep) => {
    if (next.step !== step) throw new Error(`Complete the ${next.step} step before this action`);
  };
  switch (action.kind) {
    case "outcome":
      requireStep("outcome");
      if (action.outcome !== "inspect" && action.outcome !== "plan") throw new Error("Choose an outcome");
      next.outcome = action.outcome;
      next.step = "context";
      break;
    case "context":
      if (next.step === "outcome") requireStep("context");
      next.defaults = parseFirstUseDefaults(action.defaults);
      if (next.step !== "complete") {
        next.step = "access";
        next.practice = { approvalHeld: false, stopped: false, retried: false, verified: false };
      }
      break;
    case "review-access":
      requireStep("access");
      if (action.permissionMode !== undefined && action.permissionMode !== "read" && action.permissionMode !== "full") throw new Error("Choose Explore or Build for the access review");
      next.permissionMode = action.permissionMode ?? "read";
      next.step = "approval";
      break;
    case "hold-approval":
      requireStep("approval");
      next.practice.approvalHeld = true;
      break;
    case "approve":
      requireStep("approval");
      if (!next.practice.approvalHeld) throw new Error("Review the approval blocker before authorizing the practice step");
      next.step = "progress";
      break;
    case "stop":
      requireStep("progress");
      next.practice.stopped = true;
      break;
    case "retry":
      requireStep("progress");
      if (!next.practice.stopped) throw new Error("Press Stop before retrying the practice run");
      next.practice.retried = true;
      next.step = "verify";
      break;
    case "verify":
      requireStep("verify");
      if (action.evidence !== "result-and-check") throw new Error("Compare the result and its check; a claim alone is not evidence");
      next.practice.verified = true;
      next.completedAt = now;
      next.step = "complete";
      break;
    default:
      throw new Error("Unknown introduction action");
  }
  next.revision++;
  return parseFirstUseState(next);
}

export type FirstUseContextResolution =
  | { kind: "ready"; context: FirstUseDefaults }
  | { kind: "repair"; context: FirstUseDefaults | null; reason: "missing" | "project" | "familiar" | "access" | "runtime" | "unavailable"; message: string };

/** Live membership is input evidence. Never trim a revoked scope into all eligible. */
export function resolveFirstUseContext(args: {
  defaults: FirstUseDefaults | null;
  explicit?: FirstUseDefaults | null;
  projectIds: readonly string[];
  familiarIds: readonly string[];
  eligibleFamiliarIds: readonly string[];
  runtimeAvailable: boolean;
}): FirstUseContextResolution {
  const context = args.explicit ?? args.defaults;
  const repair = (reason: Extract<FirstUseContextResolution, { kind: "repair" }>["reason"], message: string): FirstUseContextResolution =>
    ({ kind: "repair", context, reason, message });
  if (!context) return repair("missing", "Choose a default project and familiar scope to start new work.");
  try { parseFirstUseDefaults(context); } catch { return repair("missing", "Choose a concrete project, familiar scope and acting familiar."); }
  if (!args.projectIds.includes(context.projectId)) return repair("project", "The saved project is unavailable. Choose a project in the guide.");
  if (context.familiarIds.some((id) => !args.familiarIds.includes(id))) return repair("familiar", "A saved familiar is unavailable. Review the configured familiar scope.");
  if (context.familiarIds.some((id) => !args.eligibleFamiliarIds.includes(id))) return repair("access", "A saved familiar no longer has project access. Review access or choose another scope.");
  if (!args.runtimeAvailable) return repair("runtime", "The acting familiar’s runtime is unavailable. Open setup or choose an available familiar.");
  return { kind: "ready", context };
}
