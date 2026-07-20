import type { ArtifactKind, CanvasArtifact } from "./canvas-artifacts.ts";

export type CanvasGenerationPurpose = "create" | "refine";
export type CanvasGenerationPhase =
  | "generating"
  | "repairing"
  | "saving"
  | "complete"
  | "error"
  | "cancelled";

export type CanvasGenerationIdentity = {
  id: string;
  createdAt: string;
};

export type CanvasGenerationStart = {
  runId: string;
  identity: CanvasGenerationIdentity;
  familiarId: string;
  purpose: CanvasGenerationPurpose;
  /** Stable artifact title/prompt context, retained for retry and replay. */
  prompt: string;
  title: string;
  /** Fully wrapped prompt sent to the hidden Canvas chat session. */
  generationPrompt: string;
  originalIntent: string;
  expectedKind?: ArtifactKind;
  sessionId?: string | null;
};

export type CanvasGenerationSnapshot = {
  runId: string | null;
  identity: Readonly<CanvasGenerationIdentity> | null;
  purpose: CanvasGenerationPurpose | null;
  phase: CanvasGenerationPhase | null;
  streamChars: number;
  prompt: string;
  title: string;
  originalIntent: string;
  generationPrompt: string;
  familiarId: string | null;
  expectedKind: ArtifactKind | null;
  sessionId: string | null;
  startedAt: number | null;
  updatedAt: number | null;
  artifact: Readonly<CanvasArtifact> | null;
  artifacts: readonly Readonly<CanvasArtifact>[] | null;
  savedId: string | null;
  error: string | null;
};

export type CanvasGenerationProgress = {
  phase: "generating" | "repairing" | "saving";
  streamChars?: number;
};

export type CanvasGenerationExecutorResult = {
  artifact: CanvasArtifact;
  artifacts: CanvasArtifact[];
  savedId: string;
  sessionId?: string | null;
};

export type CanvasGenerationExecutor = (context: {
  start: Readonly<CanvasGenerationStart>;
  signal: AbortSignal;
  progress: (progress: CanvasGenerationProgress) => void;
}) => Promise<CanvasGenerationExecutorResult>;

type Listener = () => void;

const EMPTY_SNAPSHOT: CanvasGenerationSnapshot = Object.freeze({
  runId: null,
  identity: null,
  purpose: null,
  phase: null,
  streamChars: 0,
  prompt: "",
  title: "",
  originalIntent: "",
  generationPrompt: "",
  familiarId: null,
  expectedKind: null,
  sessionId: null,
  startedAt: null,
  updatedAt: null,
  artifact: null,
  artifacts: null,
  savedId: null,
  error: null,
});

let snapshot = EMPTY_SNAPSHOT;
let activeController: AbortController | null = null;
let executorToken = 0;
const listeners = new Set<Listener>();

function cloneArtifact(artifact: CanvasArtifact): CanvasArtifact {
  return {
    ...artifact,
    annotations: artifact.annotations?.map((annotation) => ({
      ...annotation,
      target: { ...annotation.target },
    })),
  };
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function publish(next: CanvasGenerationSnapshot): CanvasGenerationSnapshot {
  snapshot = deepFreeze(next);
  for (const listener of listeners) listener();
  return snapshot;
}

function isActivePhase(phase: CanvasGenerationPhase | null): boolean {
  return phase === "generating" || phase === "repairing" || phase === "saving";
}

function isCancellablePhase(phase: CanvasGenerationPhase | null): boolean {
  return phase === "generating" || phase === "repairing";
}

async function executeCanvasGeneration(
  context: Parameters<CanvasGenerationExecutor>[0],
): Promise<CanvasGenerationExecutorResult> {
  const [{ generateArtifactCode }, { buildArtifactRepairPrompt }, { buildArtifactRevision }] =
    await Promise.all([
      import("./canvas-generate.ts"),
      import("./canvas-artifacts.ts"),
      import("./canvas-add.ts"),
    ]);
  const { start, signal, progress } = context;
  let result = await generateArtifactCode({
    prompt: start.generationPrompt,
    familiarId: start.familiarId,
    sessionId: start.sessionId,
    signal,
    onText: (text) => progress({ phase: "generating", streamChars: text.length }),
  });

  if (result.failure === "format" && !signal.aborted) {
    progress({ phase: "repairing", streamChars: 0 });
    result = await generateArtifactCode({
      prompt: buildArtifactRepairPrompt(start.originalIntent, start.expectedKind ?? undefined),
      familiarId: start.familiarId,
      sessionId: result.sessionId,
      signal,
      onText: (text) => progress({ phase: "repairing", streamChars: text.length }),
    });
  }

  if (signal.aborted) throw new DOMException("Generation cancelled", "AbortError");
  if (!result.code || !result.kind || result.failure) {
    const message = result.failure === "format"
      ? "We couldn’t turn that response into a preview."
      : start.purpose === "refine"
        ? "We couldn’t apply that change. Your last preview is still here."
        : "We couldn’t create that preview. Try again.";
    throw new Error(message);
  }

  const artifact = buildArtifactRevision({
    identity: start.identity,
    prompt: start.prompt,
    code: result.code,
    kind: result.kind,
    updatedAt: new Date().toISOString(),
  });
  progress({ phase: "saving", streamChars: result.text.length });
  const response = await fetch("/api/canvas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ artifact }),
    signal,
  });
  if (!response.ok) throw new Error("Couldn’t save this preview.");
  const data = (await response.json()) as {
    artifacts?: CanvasArtifact[];
    savedId?: string | null;
  };
  const savedId = data.savedId ?? artifact.id;
  const savedArtifact = data.artifacts?.find((entry) => entry.id === savedId) ?? artifact;
  return {
    artifact: savedArtifact,
    artifacts: data.artifacts ?? [],
    savedId,
    sessionId: result.sessionId,
  };
}

export function getCanvasGenerationSnapshot(): CanvasGenerationSnapshot {
  return snapshot;
}

export function subscribeCanvasGeneration(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startCanvasGeneration(
  input: CanvasGenerationStart,
  execute: CanvasGenerationExecutor = executeCanvasGeneration,
): CanvasGenerationSnapshot {
  if (snapshot.runId !== null) return snapshot;

  const start = deepFreeze({
    ...input,
    identity: { ...input.identity },
    expectedKind: input.expectedKind ?? undefined,
    sessionId: input.sessionId ?? null,
  });
  const controller = new AbortController();
  activeController = controller;
  const token = ++executorToken;
  const now = Date.now();
  const started = publish({
    runId: start.runId,
    identity: start.identity,
    purpose: start.purpose,
    phase: "generating",
    streamChars: 0,
    prompt: start.prompt,
    title: start.title,
    originalIntent: start.originalIntent,
    generationPrompt: start.generationPrompt,
    familiarId: start.familiarId,
    expectedKind: start.expectedKind ?? null,
    sessionId: start.sessionId,
    startedAt: now,
    updatedAt: now,
    artifact: null,
    artifacts: null,
    savedId: null,
    error: null,
  });

  const progress = (update: CanvasGenerationProgress) => {
    if (
      token !== executorToken ||
      snapshot.runId !== start.runId ||
      controller.signal.aborted ||
      !isActivePhase(snapshot.phase)
    ) return;
    publish({
      ...snapshot,
      phase: update.phase,
      streamChars: update.streamChars ?? snapshot.streamChars,
      updatedAt: Date.now(),
    });
  };

  void execute({ start, signal: controller.signal, progress }).then(
    (result) => {
      if (
        token !== executorToken ||
        snapshot.runId !== start.runId ||
        controller.signal.aborted ||
        !isActivePhase(snapshot.phase)
      ) return;
      activeController = null;
      publish({
        ...snapshot,
        phase: "complete",
        updatedAt: Date.now(),
        artifact: cloneArtifact(result.artifact),
        artifacts: result.artifacts.map(cloneArtifact),
        savedId: result.savedId,
        sessionId: result.sessionId ?? snapshot.sessionId,
        error: null,
      });
    },
    (error: unknown) => {
      if (
        token !== executorToken ||
        snapshot.runId !== start.runId ||
        controller.signal.aborted ||
        !isActivePhase(snapshot.phase)
      ) return;
      activeController = null;
      publish({
        ...snapshot,
        phase: "error",
        updatedAt: Date.now(),
        error: error instanceof Error ? error.message : "Canvas generation failed.",
      });
    },
  );
  return started;
}

export function stopCanvasGeneration(runId: string): boolean {
  if (snapshot.runId !== runId || !isCancellablePhase(snapshot.phase)) return false;
  activeController?.abort();
  activeController = null;
  executorToken += 1;
  publish({
    ...snapshot,
    phase: "cancelled",
    updatedAt: Date.now(),
    error: null,
  });
  return true;
}

export function consumeCanvasGeneration(runId: string): boolean {
  if (
    snapshot.runId !== runId ||
    snapshot.phase === null ||
    isActivePhase(snapshot.phase)
  ) return false;
  snapshot = EMPTY_SNAPSHOT;
  for (const listener of listeners) listener();
  return true;
}

export function resetCanvasGenerationRegistryForTests(): void {
  activeController?.abort();
  activeController = null;
  executorToken += 1;
  snapshot = EMPTY_SNAPSHOT;
  listeners.clear();
}
