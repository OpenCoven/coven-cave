"use client";

import { useCallback, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { EmptyState } from "@/components/ui/empty-state";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  rollupEvalGroup,
  type EvalGroup,
  type EvalGroupScope,
  type EvalTrack,
  type ThreadEvalState,
} from "@/lib/evals/eval-model";

type Props = {
  groups: EvalGroup[];
  statesById: Map<string, ThreadEvalState[]>;
  familiars: ResolvedFamiliar[];
  onChanged: () => void;
};

const SCOPE_OPTIONS: Array<{ value: EvalGroupScope; label: string }> = [
  { value: "thread", label: "Thread" },
  { value: "familiar", label: "Familiar" },
  { value: "project", label: "Project" },
  { value: "release", label: "Release" },
  { value: "custom", label: "Custom" },
];

const TRACK_OPTIONS: Array<{ value: EvalTrack; label: string }> = [
  { value: "synthesis", label: "Synthesis" },
  { value: "prompt", label: "Prompt" },
  { value: "memory", label: "Memory" },
  { value: "confidence", label: "Confidence" },
  { value: "regression", label: "Regression" },
];

const HOUR_MS = 60 * 60 * 1000;

function newGroup(rubricVersion: string): EvalGroup {
  const now = new Date().toISOString();
  let id: string;
  try {
    id = crypto.randomUUID();
  } catch {
    id = `group-${Date.now().toString(36)}`;
  }
  return {
    id,
    name: "Untitled group",
    description: "",
    scope: "custom",
    members: [],
    tracks: ["synthesis"],
    rubricVersion: rubricVersion || "v1",
    stalePolicy: {},
    schedulePolicy: { mode: "manual" },
    createdAt: now,
    updatedAt: now,
  };
}

export function EvalGroupsPanel({ groups, statesById, familiars, onChanged }: Props) {
  const [draft, setDraft] = useState<EvalGroup | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugGroupIds, setDebugGroupIds] = useState<Set<string>>(() => new Set());

  const familiarName = useCallback(
    (id: string) => familiars.find((f) => f.id === id)?.display_name ?? id,
    [familiars],
  );

  const rollups = useMemo(
    () => new Map(groups.map((group) => [group.id, rollupEvalGroup(group, statesById.get(group.id) ?? [])])),
    [groups, statesById],
  );

  const existingRubric = groups[0]?.rubricVersion ?? "v1";

  const startCreate = useCallback(() => {
    setDraft(newGroup(existingRubric));
    setIsNew(true);
    setError(null);
  }, [existingRubric]);

  const startEdit = useCallback((group: EvalGroup) => {
    setDraft(structuredClone(group));
    setIsNew(false);
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    setDraft(null);
    setError(null);
  }, []);

  const toggleGroupDebug = useCallback((groupId: string) => {
    setDebugGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const patch = useCallback((p: Partial<EvalGroup>) => {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }, []);

  const toggleTrack = useCallback((track: EvalTrack) => {
    setDraft((d) => {
      if (!d) return d;
      const has = d.tracks.includes(track);
      return { ...d, tracks: has ? d.tracks.filter((t) => t !== track) : [...d.tracks, track] };
    });
  }, []);

  const toggleFamiliar = useCallback((familiarId: string) => {
    setDraft((d) => {
      if (!d) return d;
      const has = d.members.some((m) => m.kind === "familiar" && m.id === familiarId);
      const members = has
        ? d.members.filter((m) => !(m.kind === "familiar" && m.id === familiarId))
        : [...d.members, { kind: "familiar" as const, id: familiarId, familiarId }];
      return { ...d, members };
    });
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const group: EvalGroup = { ...draft, updatedAt: new Date().toISOString() };
      const res = await fetch("/api/evals/groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ group }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error || "Save failed");
        return;
      }
      setDraft(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [draft, onChanged]);

  const remove = useCallback(
    async (group: EvalGroup) => {
      if (typeof window !== "undefined" && !window.confirm(`Delete eval group "${group.name}"?`)) return;
      try {
        await fetch(`/api/evals/groups?id=${encodeURIComponent(group.id)}`, { method: "DELETE" });
        if (draft?.id === group.id) setDraft(null);
        onChanged();
      } catch {
        // best-effort; the list refetch will reflect reality
      }
    },
    [draft, onChanged],
  );

  return (
    <div className="evals-groups">
      <div className="evals-section-head">
        <span className="evals-group-kicker">Eval groups</span>
        <button type="button" className="evals-btn" onClick={startCreate}>
          <Icon name="ph:plus" width={13} /> New group
        </button>
      </div>

      {groups.length === 0 && !draft ? (
        <EmptyState
          icon="ph:squares-four"
          headline="No eval groups yet"
          subtitle="Group threads and familiars into a tracked eval set, choose which tracks to run, and watch freshness roll up across the group."
          actions={
            <button type="button" className="evals-btn evals-btn-primary" onClick={startCreate}>
              <Icon name="ph:plus" width={14} /> New group
            </button>
          }
        />
      ) : null}

      {draft ? (
        <article className="evals-group-editor" aria-label="Edit eval group">
          <label className="evals-field">
            <span>Name</span>
            <input
              className="evals-group-name-input"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              aria-label="Group name"
            />
          </label>
          <label className="evals-field">
            <span>Description</span>
            <textarea
              className="evals-desc"
              value={draft.description ?? ""}
              placeholder="What does this group track? (optional)"
              onChange={(e) => patch({ description: e.target.value })}
              rows={2}
              aria-label="Group description"
            />
          </label>
          <label className="evals-field">
            <span>Scope</span>
            <select
              className="evals-grader-kind"
              value={draft.scope}
              onChange={(e) => patch({ scope: e.target.value as EvalGroupScope })}
              aria-label="Group scope"
            >
              {SCOPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <div className="evals-field">
            <span>Tracks</span>
            <div className="evals-track-toggles" role="group" aria-label="Eval tracks">
              {TRACK_OPTIONS.map((o) => {
                const on = draft.tracks.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    className={`evals-toggle-chip${on ? " is-on" : ""}`}
                    aria-pressed={on}
                    onClick={() => toggleTrack(o.value)}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="evals-field">
            <span>Stale after (hours)</span>
            <input
              type="number"
              min={0}
              value={draft.stalePolicy.ttlMs != null ? Math.round(draft.stalePolicy.ttlMs / HOUR_MS) : ""}
              placeholder="never"
              onChange={(e) => {
                const hours = e.target.value === "" ? undefined : Number(e.target.value);
                patch({
                  stalePolicy: {
                    ttlMs: hours == null || Number.isNaN(hours) || hours <= 0 ? undefined : Math.round(hours * HOUR_MS),
                  },
                });
              }}
              aria-label="Stale policy TTL in hours"
            />
          </label>

          <div className="evals-field">
            <span>Familiar members</span>
            {familiars.length === 0 ? (
              <small className="evals-group-muted">No familiars available</small>
            ) : (
              <div className="evals-member-toggles" role="group" aria-label="Familiar members">
                {familiars.map((f) => {
                  const on = draft.members.some((m) => m.kind === "familiar" && m.id === f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      className={`evals-toggle-chip${on ? " is-on" : ""}`}
                      aria-pressed={on}
                      onClick={() => toggleFamiliar(f.id)}
                    >
                      {f.display_name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error ? <p className="evals-group-error">{error}</p> : null}

          <div className="evals-toolbar-actions">
            <button type="button" className="evals-btn evals-btn-primary" onClick={save} disabled={saving || !draft.name.trim()}>
              <Icon name="ph:check" width={13} /> {isNew ? "Create group" : "Save group"}
            </button>
            <button type="button" className="evals-btn" onClick={cancel} disabled={saving}>
              Cancel
            </button>
          </div>
        </article>
      ) : null}

      <ul className="evals-group-list">
        {groups.map((group) => {
          const rollup = rollups.get(group.id);
          const states = statesById.get(group.id) ?? [];
          const debugOpen = debugGroupIds.has(group.id);
          const debugPanelId = `eval-group-debug-${group.id}`;
          const memberFamiliars = group.members.filter((m) => m.kind === "familiar");
          return (
            <li key={group.id} className="evals-group-card">
              <div className="evals-group-card-head">
                <div className="evals-group-summary">
                  <b>{group.name}</b>
                  <span className="evals-group-muted">
                    {group.scope} · {group.tracks.length ? group.tracks.join(", ") : "no tracks"}
                  </span>
                </div>
                <div className="evals-group-card-actions">
                  <button
                    type="button"
                    className="evals-icon-btn"
                    onClick={() => toggleGroupDebug(group.id)}
                    title="Debug group"
                    aria-label="Toggle group debug details"
                    aria-expanded={debugOpen}
                    aria-controls={debugPanelId}
                  >
                    <Icon name="ph:bug-bold" width={13} />
                  </button>
                  <button type="button" className="evals-icon-btn" onClick={() => startEdit(group)} title="Edit group" aria-label="Edit group">
                    <Icon name="ph:pencil-simple" width={13} />
                  </button>
                  <button type="button" className="evals-icon-btn" onClick={() => void remove(group)} title="Delete group" aria-label="Delete group">
                    <Icon name="ph:trash" width={13} />
                  </button>
                </div>
              </div>
              {group.description ? <p className="evals-group-desc">{group.description}</p> : null}
              {rollup ? (
                <div className="evals-group-rollup" aria-label="Group freshness rollup">
                  <span className="evals-chip">{rollup.totalThreads} threads</span>
                  <span className="evals-chip is-pass">{rollup.freshThreads} fresh</span>
                  <span className="evals-chip is-fail">{rollup.staleThreads} stale</span>
                  <span className="evals-chip">{rollup.neverRunThreads} never run</span>
                </div>
              ) : null}
              {memberFamiliars.length ? (
                <div className="evals-group-members">
                  {memberFamiliars.map((m) => (
                    <span key={m.id} className="evals-toggle-chip is-on">
                      {familiarName(m.familiarId ?? m.id)}
                    </span>
                  ))}
                </div>
              ) : null}
              {debugOpen ? (
                <div id={debugPanelId} className="evals-group-debug" aria-label="Group debug details">
                  <div className="evals-group-debug-title">Group debug details</div>
                  <pre>
                    {JSON.stringify(
                      {
                        group: {
                          id: group.id,
                          name: group.name,
                          scope: group.scope,
                          tracks: group.tracks,
                          rubricVersion: group.rubricVersion,
                          stalePolicy: group.stalePolicy,
                          schedulePolicy: group.schedulePolicy,
                          createdAt: group.createdAt,
                          updatedAt: group.updatedAt,
                          members: group.members.map((member) => ({
                            ...member,
                            label: member.kind === "familiar" ? familiarName(member.familiarId ?? member.id) : member.id,
                          })),
                        },
                        rollup: rollup ?? null,
                        states: states.map((state) => ({
                          threadId: state.threadId,
                          familiarId: state.familiarId,
                          status: state.status,
                          staleReasons: state.staleReasons,
                          evaluatedAt: state.evaluatedAt,
                          details: state.details,
                        })),
                      },
                      null,
                      2,
                    )}
                  </pre>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
