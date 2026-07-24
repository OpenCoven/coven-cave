"use client";

import { useRef, useState } from "react";
import { ProjectPicker } from "@/components/project-picker";
import { NO_PROJECT_ID } from "@/lib/chat-projects";
import { useProjects } from "@/lib/use-projects";
import { publishQueueProjectSelection } from "@/lib/queue-project-selection";

type QueueReadinessView = {
  ok: boolean;
  message: string;
  canGenerate: boolean;
  project: { id: string; name: string; root: string } | null;
};

/** The Queue always starts with a concrete, host-native project selection.
 * Setup lives on the Tasks page's Queue tab — not the onboarding wizard — so
 * the choice is only asked for when the Queue is actually opened. This
 * component deliberately uses the same project picker as the rest of Cave,
 * including the native folder chooser used to register a new root. A saved
 * selection is published so every mounted Queue surface reloads together. */
export function QueueProjectSetup({
  selectedProjectId,
  onSelected,
}: {
  /** The currently persisted Queue project id, if any. */
  selectedProjectId?: string | null;
  onSelected?: (readiness: QueueReadinessView) => void;
}) {
  const { projects, loading, createProject } = useProjects();
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  const selectProject = async (projectId: string) => {
    const generation = ++requestGeneration.current;
    setSelecting(true);
    setError(null);
    try {
      const response = await fetch("/api/queue/readiness", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "select", projectId }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        readiness?: QueueReadinessView;
        error?: string;
      };
      if (!response.ok || !body.ok || !body.readiness) {
        throw new Error(body.error ?? "Couldn’t save the Queue project.");
      }
      if (generation !== requestGeneration.current) return;
      publishQueueProjectSelection(body.readiness.project);
      onSelected?.(body.readiness);
    } catch (cause) {
      if (generation === requestGeneration.current) {
        setError(cause instanceof Error ? cause.message : "Couldn’t save the Queue project.");
      }
    } finally {
      if (generation === requestGeneration.current) setSelecting(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <ProjectPicker
        projects={projects}
        value={selectedProjectId ?? NO_PROJECT_ID}
        onChange={(projectId) => void selectProject(projectId)}
        createProject={createProject}
        disabled={loading || selecting}
        ariaLabel="Choose Queue project"
      />
      {error ? (
        <p className="text-[length:var(--text-xs)] text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
