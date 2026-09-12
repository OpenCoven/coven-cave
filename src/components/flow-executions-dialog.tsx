"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Modal } from "@/components/ui/modal";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useFlowDiscussion } from "@/lib/flow-discussion";
import type { FlowRunRecord } from "@/lib/flows";
import type { SessionRow } from "@/lib/types";

type RunGroup = { id: string; label: string; runs: FlowRunRecord[] };

export function groupFlowRuns(runs: FlowRunRecord[], sessions: SessionRow[] = []): RunGroup[] {
  const sessionIndex = new Map(sessions.map((session) => [session.id, session]));
  const runMissions = new Map(sessions
    .filter((session) => session.flow?.missionId)
    .map((session) => [session.flow!.runId, session.flow!.missionId]));
  const groups = new Map<string, RunGroup>();
  for (const run of runs) {
    const missionId = run.missionId
      ?? (run.sessionId ? sessionIndex.get(run.sessionId)?.flow?.missionId : undefined)
      ?? runMissions.get(run.id);
    const id = missionId ? `mission:${missionId}` : `flow:${run.flowId}`;
    const group = groups.get(id) ?? {
      id,
      label: missionId ? `Research · ${missionId}` : run.flowName || run.flowId,
      runs: [],
    };
    group.runs.push(run);
    groups.set(id, group);
  }
  return [...groups.values()];
}

type Props = {
  open: boolean;
  onClose(): void;
  onOpenSession(sessionId: string, familiarId: string): void;
  initialRunId?: string;
  initialSessionId?: string;
  sessions?: SessionRow[];
};

export function FlowExecutionsDialog({
  open, onClose, onOpenSession, initialRunId, initialSessionId, sessions = [],
}: Props) {
  const [selectedRunId, setSelectedRunId] = useState(initialRunId ?? null);
  const [selectedSessionId, setSelectedSessionId] = useState(initialSessionId ?? null);
  const [runs, setRuns] = useState<FlowRunRecord[]>([]);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const discussion = useFlowDiscussion((sessionId, familiarId) => {
    onOpenSession(sessionId, familiarId);
    onClose();
  }, open ? selectedSessionId : null);
  const groups = useMemo(() => groupFlowRuns(
    selectedRunId ? runs.filter((run) => run.id === selectedRunId) : runs,
    sessions,
  ), [runs, sessions, selectedRunId]);
  const sessionsByRun = useMemo(() => {
    const index = new Map<string, Array<Pick<SessionRow, "id"> & Partial<Pick<SessionRow, "title" | "familiarId">>>>();
    for (const run of runs) {
      const owned = sessions.filter((session) => session.flow?.runId === run.id);
      const source = run.sessionId ? sessions.find((session) => session.id === run.sessionId) : undefined;
      index.set(run.id, [
        ...(run.sessionId ? [source ?? { id: run.sessionId }] : []),
        ...owned.filter((session) => session.id !== run.sessionId),
      ]);
    }
    return index;
  }, [runs, sessions]);

  useEffect(() => {
    setSelectedRunId(initialRunId ?? null);
    setSelectedSessionId(initialSessionId ?? null);
  }, [open, initialRunId, initialSessionId]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setTranscript(null);
    const url = selectedSessionId
      ? `/api/flows/session-transcript?${new URLSearchParams({ sessionId: selectedSessionId })}`
      : "/api/flows/runs";
    void (async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const result = await response.json() as {
          ok?: boolean; runs?: FlowRunRecord[]; transcript?: string; error?: string;
        };
        if (!response.ok || !result.ok) throw new Error(result.error || "Try again.");
        if (controller.signal.aborted) return;
        if (selectedSessionId) {
          if (typeof result.transcript !== "string") throw new Error("The transcript response was incomplete. Try again.");
          setTranscript(result.transcript);
        } else {
          if (!Array.isArray(result.runs)) throw new Error("The history response was incomplete. Try again.");
          setRuns(result.runs);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Try again.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [open, selectedSessionId, revision]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      breadcrumb={selectedSessionId ? ["Flow runs", "Transcript"] : ["Chat", "Flow runs"]}
      wide
      footerActions={<Button onClick={onClose}>Close</Button>}
    >
      <div className="flex flex-col gap-4">
        <p className="text-[length:var(--text-sm)] text-[var(--text-secondary)]">
          Flow executions stay separate from Chat. Transcripts are read-only; Discuss in Chat opens a separate conversation.
        </p>
        {selectedSessionId || selectedRunId ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => {
              setSelectedRunId(null);
              setSelectedSessionId(null);
            }}>All Flow runs</Button>
            {selectedSessionId ? (
              <Button size="sm" loading={discussion.busy} onClick={() => void discussion.discuss(selectedSessionId)}>
                Discuss in Chat
              </Button>
            ) : null}
          </div>
        ) : null}
        {discussion.error ? (
          <ErrorState compact live={false} headline="Couldn’t open discussion" subtitle={discussion.error} />
        ) : null}
        {loading ? (
          <div role="status" aria-label={selectedSessionId ? "Loading transcript…" : "Loading Flow runs…"}>
            <SkeletonRows count={3} />
          </div>
        ) : error ? (
          <ErrorState
            compact
            headline={selectedSessionId ? "Couldn’t load transcript" : "Couldn’t load Flow runs"}
            subtitle={error}
            actions={<Button size="sm" onClick={() => setRevision((value) => value + 1)}>Retry</Button>}
          />
        ) : selectedSessionId ? (
          transcript?.trim() ? (
            <pre className="whitespace-pre-wrap break-words rounded-[var(--radius-control)] bg-[var(--bg-sunken)] p-4 text-[length:var(--text-sm)] text-[var(--text-primary)]" aria-label="Read-only Flow transcript">
              {transcript}
            </pre>
          ) : (
            <EmptyState compact headline="No transcript yet" subtitle="The execution hasn’t reported output. Refresh to check again."
              actions={<Button size="sm" onClick={() => setRevision((value) => value + 1)}>Refresh transcript</Button>} />
          )
        ) : selectedRunId && groups.length === 0 ? (
          <ErrorState compact headline="Flow run unavailable"
            subtitle={`Run ${selectedRunId} is no longer in execution history. A direct transcript link can still be opened.`}
            actions={<Button size="sm" onClick={() => setRevision((value) => value + 1)}>Retry</Button>} />
        ) : groups.length === 0 ? (
          <EmptyState compact headline="No Flow runs yet" subtitle="Run a Flow or start research, then return here to inspect its executions." />
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <section key={group.id} aria-label={group.label} className="flex flex-col gap-2">
                <h2 className="text-[length:var(--text-base)] font-medium text-[var(--text-primary)]">{group.label}</h2>
                {group.runs.map((run) => {
                  const runSessions = sessionsByRun.get(run.id) ?? [];
                  return (
                  <details key={run.id} open={selectedRunId === run.id || undefined} className="rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-raised)] p-3">
                    <summary className="focus-ring cursor-pointer text-[length:var(--text-sm)] text-[var(--text-primary)]">
                      {run.iteration != null ? `Iteration ${run.iteration}` : run.flowName || run.flowId}
                      {" · "}{run.status}{" · "}<time dateTime={run.startedAt}>{run.startedAt}</time>
                    </summary>
                    <div className="mt-3 flex flex-col gap-2 text-[length:var(--text-sm)] text-[var(--text-secondary)]">
                      <p className="break-words">Run {run.id}</p>
                      {run.summary ? <p className="whitespace-pre-wrap">{run.summary}</p> : null}
                      {run.steps.length ? (
                        <ol className="flex flex-col gap-2" aria-label="Execution steps">
                          {run.steps.map((step, index) => (
                            <li key={`${step.id}:${index}`}>
                              <span>{step.id} · {step.status}</span>
                              {step.detail ? <p className="whitespace-pre-wrap">{step.detail}</p> : null}
                            </li>
                          ))}
                        </ol>
                      ) : <p>{run.redacted ? "Step details were not retained." : "No step details reported."}</p>}
                      {runSessions.length ? runSessions.map((execution) => (
                        <div key={execution.id} className="flex flex-col gap-2">
                          <p className="break-words">
                            {execution.title || `Execution ${execution.id}`}
                            {execution.familiarId ? ` · ${execution.familiarId}` : ""}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button size="xs" onClick={() => setSelectedSessionId(execution.id)}>View transcript</Button>
                            <Button size="xs" variant="ghost" loading={discussion.busy} onClick={() => void discussion.discuss(execution.id)}>
                              Discuss in Chat
                            </Button>
                          </div>
                        </div>
                      )) : <p>No transcript session recorded.</p>}
                    </div>
                  </details>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
