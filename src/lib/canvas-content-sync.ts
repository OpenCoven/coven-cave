import {
  overlayCanvasArtifactSnapshot,
  type CanvasAnnotationOperation,
} from "./canvas-annotation-operation-queue.ts";
import type {
  ArtifactKind,
  CanvasAnnotation,
  CanvasArtifact,
} from "./canvas-artifacts.ts";

export type CanvasContentReconciliation = {
  acceptedArtifact: CanvasArtifact;
  reportedArtifact: CanvasArtifact;
  code: string;
  kind: ArtifactKind;
  annotations: CanvasAnnotation[];
  contentDirty: boolean;
  contentConflict: boolean;
};

export function canvasContentDiffers(
  artifact: CanvasArtifact,
  code: string,
  kind: ArtifactKind,
): boolean {
  return artifact.code !== code || (artifact.kind ?? "html") !== kind;
}

export function reconcileCanvasAnnotationSnapshot({
  acceptedArtifact,
  incomingArtifact,
  localCode,
  localKind,
  pendingOperations,
  contentConflict = false,
}: {
  acceptedArtifact: CanvasArtifact;
  incomingArtifact: CanvasArtifact;
  localCode: string;
  localKind: ArtifactKind;
  pendingOperations: CanvasAnnotationOperation[];
  contentConflict?: boolean;
}): CanvasContentReconciliation {
  const dirty = canvasContentDiffers(acceptedArtifact, localCode, localKind);
  const incoming = overlayCanvasArtifactSnapshot(incomingArtifact, pendingOperations);

  if (incoming.updatedAt < acceptedArtifact.updatedAt) {
    const accepted = overlayCanvasArtifactSnapshot(acceptedArtifact, pendingOperations);
    return {
      acceptedArtifact: accepted,
      reportedArtifact: accepted,
      code: localCode,
      kind: localKind,
      annotations: accepted.annotations ?? [],
      contentDirty: dirty,
      contentConflict,
    };
  }

  if (dirty && incoming.updatedAt > acceptedArtifact.updatedAt) {
    const accepted: CanvasArtifact = {
      ...acceptedArtifact,
      ...(incoming.annotations?.length ? { annotations: incoming.annotations } : {}),
    };
    if (!incoming.annotations?.length) delete accepted.annotations;
    return {
      acceptedArtifact: accepted,
      reportedArtifact: incoming,
      code: localCode,
      kind: localKind,
      annotations: incoming.annotations ?? [],
      contentDirty: true,
      contentConflict: true,
    };
  }

  if (dirty) {
    const accepted: CanvasArtifact = {
      ...acceptedArtifact,
      ...(incoming.annotations?.length ? { annotations: incoming.annotations } : {}),
    };
    if (!incoming.annotations?.length) delete accepted.annotations;
    return {
      acceptedArtifact: accepted,
      reportedArtifact: incoming,
      code: localCode,
      kind: localKind,
      annotations: incoming.annotations ?? [],
      contentDirty: true,
      contentConflict,
    };
  }

  return adoptCanvasContentSnapshot(incoming, []);
}

export function adoptCanvasContentSnapshot(
  artifact: CanvasArtifact,
  pendingOperations: CanvasAnnotationOperation[],
): CanvasContentReconciliation {
  const accepted = overlayCanvasArtifactSnapshot(artifact, pendingOperations);
  return {
    acceptedArtifact: accepted,
    reportedArtifact: accepted,
    code: accepted.code,
    kind: accepted.kind ?? "html",
    annotations: accepted.annotations ?? [],
    contentDirty: false,
    contentConflict: false,
  };
}
