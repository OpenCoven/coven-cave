"use client";

import { useEffect, useState } from "react";

import { SyntaxBlock } from "@/components/message-bubble";
import { Modal } from "@/components/ui/modal";
import { resolvePathWithinProjectRoot } from "@/lib/cave-projects-types";

type EditCardActionsProps = {
  projectRoot: string | null;
  sourceSessionId: string | null;
  turnId: string | null;
  mutationPaths: string[];
  diff: string;
  displayPath: string;
};

type UndoState = {
  targetIdentity: string;
  phase: "idle" | "armed" | "reverting" | "reverted" | "error";
  error: string | null;
};

function idleUndoState(targetIdentity: string): UndoState {
  return { targetIdentity, phase: "idle", error: null };
}

// Review + Undo actions for a normalized inline mutation card. Review adapts to
// where the edit can actually be reviewed: a file under the session's project
// root jumps to its diff in the code rail's Changes panel (cumulative diff +
// checkpoint/undo tools); anything else opens an in-chat modal with this edit's
// full diff. Undo requires a two-step arm→confirm and only appears when exactly
// one target resolves under the immutable execution root.
export function EditCardActions({
  projectRoot,
  sourceSessionId,
  turnId,
  mutationPaths,
  diff,
  displayPath,
}: EditCardActionsProps) {
  const resolvedMutationPaths = mutationPaths
    .map((path) => resolvePathWithinProjectRoot(projectRoot, path))
    .filter((path): path is NonNullable<typeof path> => path !== null);
  const allMutationPathsResolved =
    mutationPaths.length > 0 && resolvedMutationPaths.length === mutationPaths.length;
  const singleProjectPath = allMutationPathsResolved && resolvedMutationPaths.length === 1
    ? resolvedMutationPaths[0] ?? null
    : null;
  const canUndo = allMutationPathsResolved && resolvedMutationPaths.length === 1;
  const undoTargetIdentity = JSON.stringify([projectRoot, ...mutationPaths]);
  const [undo, setUndo] = useState<UndoState>(() => idleUndoState(undoTargetIdentity));
  const undoTargetIsCurrent = undo.targetIdentity === undoTargetIdentity;
  const state = undoTargetIsCurrent ? undo.phase : "idle";
  const err = undoTargetIsCurrent ? undo.error : null;
  const [reviewOpen, setReviewOpen] = useState(false);
  const base = displayPath.split("/").pop() || displayPath;

  useEffect(() => {
    setUndo((current) =>
      current.targetIdentity === undoTargetIdentity
        ? current
        : idleUndoState(undoTargetIdentity),
    );
  }, [undoTargetIdentity]);

  const review = () => {
    if (singleProjectPath && projectRoot) {
      window.dispatchEvent(
        new CustomEvent("cave:open-file-diff", {
          detail: { path: singleProjectPath.absolutePath, projectRoot, sourceSessionId, turnId },
        }),
      );
    } else {
      setReviewOpen(true);
    }
  };

  const doUndo = async () => {
    if (
      state !== "armed" ||
      undo.targetIdentity !== undoTargetIdentity ||
      !projectRoot ||
      !canUndo ||
      !singleProjectPath
    ) {
      setUndo(idleUndoState(undoTargetIdentity));
      return;
    }
    const requestIdentity = undoTargetIdentity;
    setUndo({ targetIdentity: requestIdentity, phase: "reverting", error: null });
    try {
      const res = await fetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRoot, path: singleProjectPath.absolutePath, confirmUntracked: true }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || `revert failed (${res.status})`);
      setUndo((current) =>
        current.targetIdentity === requestIdentity
          ? { ...current, phase: "reverted" }
          : current,
      );
      window.dispatchEvent(new CustomEvent("cave:changes-refresh"));
    } catch (error) {
      setUndo((current) =>
        current.targetIdentity === requestIdentity
          ? {
              ...current,
              phase: "error",
              error: (error as Error)?.message ?? "revert failed",
            }
          : current,
      );
    }
  };

  return (
    <span className="cave-edit-card__actions" onClick={(event) => event.stopPropagation()}>
      {err ? <span className="cave-edit-card__error" title={err}>{err}</span> : null}
      <button
        type="button"
        className="cave-edit-card__review focus-ring"
        onClick={review}
        title={
          singleProjectPath
            ? "Review this file's pending diff in the Changes panel"
            : "Review this edit's full diff"
        }
      >
        Review
      </button>
      <Modal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        breadcrumb={["Review", base]}
        wide
      >
        <div className="cave-review-modal">
          <p className="cave-review-modal__path" title={displayPath}>
            {displayPath}
          </p>
          <SyntaxBlock text={diff} lang="diff" />
        </div>
      </Modal>
      {canUndo ? (
        state === "reverted" ? (
          <span className="cave-edit-card__reverted">Reverted</span>
        ) : state === "reverting" ? (
          <button type="button" className="cave-edit-card__undo focus-ring" disabled>
            Undoing…
          </button>
        ) : state === "armed" ? (
          <>
            <button
              type="button"
              className="cave-edit-card__undo focus-ring"
              onClick={() => setUndo(idleUndoState(undoTargetIdentity))}
            >
              Cancel
            </button>
            <button type="button" className="cave-edit-card__undo cave-edit-card__undo--confirm focus-ring" onClick={doUndo}>
              Confirm undo
            </button>
          </>
        ) : (
          <button
            type="button"
            className="cave-edit-card__undo focus-ring"
            onClick={() => setUndo({
              targetIdentity: undoTargetIdentity,
              phase: "armed",
              error: null,
            })}
            title="Revert this file to its last committed state (a checkpoint is saved first)"
          >
            Undo
          </button>
        )
      ) : null}
    </span>
  );
}
