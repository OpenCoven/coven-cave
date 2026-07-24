"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Icon } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import { openGrimoireDoc } from "@/lib/grimoire-link";
import { getResearchMissionFile, type ResearchMissionFile } from "@/lib/research-mission-client";
import type { ResearchArtifactRef, ResearchMission } from "@/lib/research-missions";

type ResearchArtifactActionsProps = {
  mission: ResearchMission;
  artifact: ResearchArtifactRef;
  busy?: boolean;
  /** When provided and the ref is an unpublished working copy, renders the
   *  Publish action. Surfaces that must not offer publishing omit it. */
  onPublish?: (artifactKey: string) => void;
};

function downloadTextFile(fileName: string, content: string) {
  const type = fileName.endsWith(".json") ? "application/json" : "text/markdown";
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Resolve the mission workspace path for "Copy workspace path" affordances.
 *  workspacePath is mission-level, not artifact-level, but the route still
 *  needs a real artifact key to look up (see files/[key]/route.ts) — a
 *  legacy mission with an empty/odd artifacts array may have no "primary"
 *  key, so callers should pass the mission's actual first artifact key when
 *  they have one; "primary" remains the default for ordinary missions. */
export async function fetchResearchWorkspacePath(
  missionId: string,
  artifactKey = "primary",
): Promise<string | null> {
  try {
    const file = await getResearchMissionFile(missionId, artifactKey);
    return file.workspacePath;
  } catch {
    return null;
  }
}

export function ResearchArtifactActions({ mission, artifact, busy, onPublish }: ResearchArtifactActionsProps) {
  const { announce } = useAnnouncer();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ResearchMissionFile | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

  const loadFile = async (): Promise<ResearchMissionFile | null> => {
    setPending(true);
    setError(null);
    try {
      return await getResearchMissionFile(mission.id, artifact.key);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Research file could not be read.";
      setError(message);
      announce(message);
      return null;
    } finally {
      setPending(false);
    }
  };

  const view = async () => {
    if (pending) return;
    const file = await loadFile();
    if (!file) return;
    setViewing(file);
    setViewerOpen(true);
  };

  const download = async () => {
    if (pending) return;
    const file = await loadFile();
    if (!file) return;
    if (file.content === null) {
      const message = `${artifact.title} has not been written yet.`;
      setError(message);
      announce(message);
      return;
    }
    downloadTextFile(file.fileName, file.content);
    announce(`${artifact.title} downloaded.`);
  };

  const disabled = Boolean(busy) || pending;
  const showPublish = Boolean(onPublish) && artifact.state === "working" && !artifact.knowledgeId;

  // Use a named handler with an early-return guard so TypeScript can narrow
  // artifact.knowledgeId to string within this function body while the call
  // site keeps the exact shape openGrimoireDoc("knowledge", artifact.knowledgeId).
  const openInGrimoire = () => {
    if (!artifact.knowledgeId) return;
    openGrimoireDoc("knowledge", artifact.knowledgeId);
  };

  return (
    <>
      <div className="research-desk-artifact__actions">
        <button
          type="button"
          className="research-desk-artifact__open focus-ring"
          onClick={view}
          disabled={Boolean(busy)}
          aria-busy={pending}
          aria-label={`View ${artifact.title}`}
        >
          <Icon name="ph:file-text" width={14} height={14} aria-hidden />
          View
        </button>
        <button
          type="button"
          className="research-desk-artifact__open focus-ring"
          onClick={download}
          disabled={Boolean(busy)}
          aria-busy={pending}
          aria-label={`Download ${artifact.title}`}
        >
          <Icon name="ph:download-simple" width={14} height={14} aria-hidden />
          Download
        </button>
        {artifact.knowledgeId ? (
          <button
            type="button"
            className="research-desk-artifact__open focus-ring"
            onClick={openInGrimoire}
            aria-label={`Open ${artifact.title} in the Grimoire`}
          >
            <Icon name="ph:arrow-square-out" width={14} height={14} aria-hidden />
            Grimoire
          </button>
        ) : null}
        {showPublish ? (
          <button
            type="button"
            className="research-desk-artifact__open focus-ring"
            onClick={() => onPublish?.(artifact.key)}
            disabled={disabled}
            aria-label={`Publish ${artifact.title} to the Grimoire`}
          >
            <Icon name="ph:book-bookmark" width={14} height={14} aria-hidden />
            Publish
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="research-desk-artifact__error">{error}</p>
      ) : null}
      <Modal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        breadcrumb={["Research", viewing?.fileName ?? artifact.title]}
        wide
      >
        {viewing?.content === null || viewing?.content === undefined ? (
          <p className="research-artifact-viewer__empty">This file has not been written yet.</p>
        ) : (
          <pre className="research-artifact-viewer__content">{viewing.content}</pre>
        )}
      </Modal>
    </>
  );
}
