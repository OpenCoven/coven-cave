import {
  sanitizeAnnotation,
  type CanvasAnnotation,
  type CanvasArtifact,
} from "./canvas-artifacts.ts";

export type CanvasAnnotationOperation =
  | { id: string; annotation: CanvasAnnotation }
  | { id: string; removeAnnotationId: string };

type SendOperation = (operation: CanvasAnnotationOperation) => Promise<void>;
type QueueChanged = (operations: CanvasAnnotationOperation[]) => void;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STORAGE_PREFIX = "cave:canvas-annotation-operations:v1:";
const STORAGE_VERSION = 1;
const MAX_STORED_OPERATIONS = 100;

function operationAnnotationId(operation: CanvasAnnotationOperation): string {
  return "annotation" in operation ? operation.annotation.id : operation.removeAnnotationId;
}

export function canvasAnnotationOperationsStorageKey(artifactId: string): string {
  return `${STORAGE_PREFIX}${artifactId}`;
}

function sanitizeOperation(value: unknown, artifactId: string): CanvasAnnotationOperation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const operation = value as Record<string, unknown>;
  if (operation.id !== artifactId) return null;
  if ("annotation" in operation && !("removeAnnotationId" in operation)) {
    const annotation = sanitizeAnnotation(operation.annotation);
    return annotation ? { id: artifactId, annotation } : null;
  }
  if (
    "removeAnnotationId" in operation
    && !("annotation" in operation)
    && typeof operation.removeAnnotationId === "string"
  ) {
    const removeAnnotationId = operation.removeAnnotationId.trim();
    if (removeAnnotationId && removeAnnotationId.length <= 200) {
      return { id: artifactId, removeAnnotationId };
    }
  }
  return null;
}

export function readCanvasAnnotationOperations(
  storage: StorageLike | null,
  artifactId: string | undefined,
): CanvasAnnotationOperation[] {
  if (!storage || !artifactId) return [];
  try {
    const raw = storage.getItem(canvasAnnotationOperationsStorageKey(artifactId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { version?: unknown; operations?: unknown };
    if (
      !parsed
      || typeof parsed !== "object"
      || parsed.version !== STORAGE_VERSION
      || !Array.isArray(parsed.operations)
    ) {
      return [];
    }
    const operations: CanvasAnnotationOperation[] = [];
    for (const value of parsed.operations) {
      const operation = sanitizeOperation(value, artifactId);
      if (operation) operations.push(operation);
      if (operations.length === MAX_STORED_OPERATIONS) break;
    }
    return operations;
  } catch {
    return [];
  }
}

export function writeCanvasAnnotationOperations(
  storage: StorageLike | null,
  artifactId: string | undefined,
  operations: CanvasAnnotationOperation[],
): void {
  if (!storage || !artifactId) return;
  try {
    const key = canvasAnnotationOperationsStorageKey(artifactId);
    if (operations.length === 0) {
      storage.removeItem(key);
      return;
    }
    const bounded = operations.slice(0, MAX_STORED_OPERATIONS);
    storage.setItem(key, JSON.stringify({ version: STORAGE_VERSION, operations: bounded }));
  } catch {
    // Storage may be unavailable or full; the in-memory queue remains authoritative.
  }
}

export function overlayCanvasAnnotationOperations(
  annotations: CanvasAnnotation[],
  operations: CanvasAnnotationOperation[],
): CanvasAnnotation[] {
  let next = annotations.slice();
  for (const operation of operations) {
    if ("annotation" in operation) {
      const matchingIndex = next.findIndex(
        (annotation) => (
          annotation.id === operation.annotation.id
          || annotation.target.selector === operation.annotation.target.selector
        ),
      );
      if (matchingIndex >= 0) {
        next = next.slice();
        next[matchingIndex] = operation.annotation;
      } else if (next.length < 100) {
        next = [...next, operation.annotation];
      }
    } else {
      next = next.filter((annotation) => annotation.id !== operation.removeAnnotationId);
    }
  }
  return next;
}

export function overlayCanvasArtifactSnapshot(
  artifact: CanvasArtifact,
  operations: CanvasAnnotationOperation[],
): CanvasArtifact {
  const annotations = overlayCanvasAnnotationOperations(artifact.annotations ?? [], operations);
  const snapshot: CanvasArtifact = {
    ...artifact,
    ...(annotations.length > 0 ? { annotations } : {}),
  };
  if (annotations.length === 0) delete snapshot.annotations;
  return snapshot;
}

export class CanvasAnnotationOperationQueue {
  private operations: CanvasAnnotationOperation[];
  private readonly onChange?: QueueChanged;
  private drainPromise: Promise<boolean> | null = null;
  private active = false;
  blocked = false;

  constructor(
    initialOperations: CanvasAnnotationOperation[] = [],
    onChange?: QueueChanged,
  ) {
    this.operations = initialOperations.slice(0, MAX_STORED_OPERATIONS);
    this.onChange = onChange;
  }

  get size(): number {
    return this.operations.length;
  }

  enqueue(operation: CanvasAnnotationOperation): void {
    const protectedCount = this.active || this.blocked ? 1 : 0;
    const annotationId = operationAnnotationId(operation);
    const existingIndex = this.operations.findLastIndex(
      (pending, index) => index >= protectedCount && operationAnnotationId(pending) === annotationId,
    );
    if (existingIndex >= protectedCount) {
      const existing = this.operations[existingIndex];
      const canSupersede = "removeAnnotationId" in operation || "annotation" in existing;
      if (canSupersede) this.operations.splice(existingIndex, 1);
    }
    this.operations.push(operation);
    if (this.operations.length > MAX_STORED_OPERATIONS) {
      this.operations.splice(protectedCount, this.operations.length - MAX_STORED_OPERATIONS);
    }
    this.notify();
  }

  pending(limit = Number.POSITIVE_INFINITY): CanvasAnnotationOperation[] {
    return this.operations.slice(0, limit);
  }

  pendingAfterActive(): CanvasAnnotationOperation[] {
    return this.operations.slice(this.active ? 1 : 0);
  }

  drain(send: SendOperation): Promise<boolean> {
    if (this.blocked) return Promise.resolve(false);
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = this.run(send).finally(() => {
      this.drainPromise = null;
    });
    return this.drainPromise;
  }

  retry(send: SendOperation): Promise<boolean> {
    this.blocked = false;
    this.notify();
    return this.drain(send);
  }

  reset(): void {
    this.operations = [];
    this.blocked = false;
    this.notify();
  }

  private async run(send: SendOperation): Promise<boolean> {
    while (this.operations.length > 0) {
      this.active = true;
      try {
        await send(this.operations[0]);
        this.operations.shift();
        this.notify();
      } catch {
        this.blocked = true;
        this.notify();
        return false;
      } finally {
        this.active = false;
      }
    }
    return true;
  }

  private notify(): void {
    this.onChange?.(this.pending());
  }
}
