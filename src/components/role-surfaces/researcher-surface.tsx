"use client";

/**
 * Researcher Surface — an intelligence analyst's desk.
 *
 * Discovery, synthesis, investigation, and source evaluation. Left rail holds
 * the live investigation (objectives, search history, collections); the
 * center is a working canvas (notes, hypotheses, source comparison); the
 * right sidebar tracks collected evidence with confidence and conflicts plus
 * the familiar's real related memories and conversations; the bottom drawer
 * carries the reasoning trail — open questions and next actions.
 *
 * Real capabilities only: web search opens the Cave's in-app browser; related
 * memories come from the familiar's actual memory inventory; everything the
 * analyst writes (notes, evidence, objectives) is real user data persisted
 * per familiar via role-surface-state. No fake production data.
 */

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { RoleSurfaceContext, SurfaceMemoryEntry } from "@/lib/role-surfaces";
import { useRoleSurfaceState } from "@/lib/role-surface-state";
import { RailSection, SurfaceCanvas, SurfaceEmpty, SurfaceRail, SurfaceRoom } from "./surface-room";
import { RESEARCHER_SURFACE_ID } from "./ids";

type Objective = { id: string; title: string; done: boolean };
type Evidence = {
  id: string;
  claim: string;
  sourceUrl: string;
  /** 0–100 analyst-assigned confidence. */
  confidence: number;
  conflicting: boolean;
};

export type ResearcherState = {
  objectives: Objective[];
  searchHistory: string[];
  notes: string;
  hypotheses: string;
  evidence: Evidence[];
  questions: string[];
  drawerOpen: boolean;
};

export const RESEARCHER_INITIAL_STATE: ResearcherState = {
  objectives: [],
  searchHistory: [],
  notes: "",
  hypotheses: "",
  evidence: [],
  questions: [],
  drawerOpen: false,
};

const uid = () => Math.random().toString(36).slice(2, 10);

export function searchUrlFor(query: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}

export function ResearcherSurface({ context }: { context: RoleSurfaceContext }) {
  const familiarId = context.activeFamiliar.id;
  const [state, patch] = useRoleSurfaceState<ResearcherState>(
    familiarId,
    RESEARCHER_SURFACE_ID,
    RESEARCHER_INITIAL_STATE,
  );

  const [searchDraft, setSearchDraft] = useState("");
  const [objectiveDraft, setObjectiveDraft] = useState("");
  const [claimDraft, setClaimDraft] = useState("");
  const [sourceDraft, setSourceDraft] = useState("");
  const [questionDraft, setQuestionDraft] = useState("");

  // Real memory inventory — related material for the desk's right sidebar.
  const [memories, setMemories] = useState<SurfaceMemoryEntry[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    context.memory.listEntries().then((entries) => {
      if (!cancelled) setMemories(entries.slice(0, 8));
    });
    return () => {
      cancelled = true;
    };
  }, [context.memory]);

  const conversations = useMemo(
    () => context.runtimeState.sessions.slice(0, 5),
    [context.runtimeState.sessions],
  );

  const runSearch = () => {
    const query = searchDraft.trim();
    if (!query) return;
    patch({ searchHistory: [query, ...state.searchHistory.filter((q) => q !== query)].slice(0, 12) });
    setSearchDraft("");
    context.openUrl(searchUrlFor(query));
  };

  const addObjective = () => {
    const title = objectiveDraft.trim();
    if (!title) return;
    patch({ objectives: [...state.objectives, { id: uid(), title, done: false }] });
    setObjectiveDraft("");
  };

  const addEvidence = () => {
    const claim = claimDraft.trim();
    if (!claim) return;
    patch({
      evidence: [
        { id: uid(), claim, sourceUrl: sourceDraft.trim(), confidence: 50, conflicting: false },
        ...state.evidence,
      ],
    });
    setClaimDraft("");
    setSourceDraft("");
  };

  const setEvidence = (id: string, update: Partial<Evidence>) => {
    patch({ evidence: state.evidence.map((e) => (e.id === id ? { ...e, ...update } : e)) });
  };

  const conflicts = state.evidence.filter((e) => e.conflicting).length;
  const meanConfidence =
    state.evidence.length > 0
      ? Math.round(state.evidence.reduce((sum, e) => sum + e.confidence, 0) / state.evidence.length)
      : null;

  return (
    <SurfaceRoom
      accentHue={278}
      drawerTitle="Reasoning trail"
      drawerOpen={state.drawerOpen}
      onToggleDrawer={() => patch({ drawerOpen: !state.drawerOpen })}
      drawer={
        <div className="role-surface-drawer-grid">
          <RailSection title="Open questions" iconName="ph:question">
            <form
              className="role-surface-inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const q = questionDraft.trim();
                if (!q) return;
                patch({ questions: [...state.questions, q] });
                setQuestionDraft("");
              }}
            >
              <input
                value={questionDraft}
                onChange={(e) => setQuestionDraft(e.target.value)}
                placeholder="What's still unanswered?"
                aria-label="Add open question"
              />
              <button type="submit" className="role-surface-chip focus-ring">Add</button>
            </form>
            {state.questions.length === 0 ? (
              <SurfaceEmpty title="No open questions logged." />
            ) : (
              <ul className="role-surface-list">
                {state.questions.map((q, i) => (
                  <li key={`${i}-${q}`} className="role-surface-list-row">
                    <span>{q}</span>
                    <button
                      type="button"
                      className="role-surface-icon-btn focus-ring"
                      aria-label={`Resolve question: ${q}`}
                      onClick={() => patch({ questions: state.questions.filter((_, j) => j !== i) })}
                    >
                      <Icon name="ph:check" width={13} height={13} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </RailSection>
          <RailSection title="Next research actions" iconName="ph:target">
            {state.objectives.filter((o) => !o.done).length === 0 ? (
              <SurfaceEmpty title="Nothing queued — add an objective." />
            ) : (
              <ul className="role-surface-list">
                {state.objectives
                  .filter((o) => !o.done)
                  .map((o) => (
                    <li key={o.id} className="role-surface-list-row">{o.title}</li>
                  ))}
              </ul>
            )}
          </RailSection>
        </div>
      }
    >
      <SurfaceRail side="left" label="Investigation">
        <RailSection title="Web search" iconName="ph:magnifying-glass">
          <form
            className="role-surface-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              runSearch();
            }}
          >
            <input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search the web…"
              aria-label="Web search"
            />
            <button type="submit" className="role-surface-chip focus-ring">Go</button>
          </form>
          {state.searchHistory.length === 0 ? (
            <SurfaceEmpty title="No searches yet." hint="Results open in the Cave browser." />
          ) : (
            <ul className="role-surface-list">
              {state.searchHistory.map((query) => (
                <li key={query}>
                  <button
                    type="button"
                    className="role-surface-row-btn focus-ring-inset"
                    onClick={() => context.openUrl(searchUrlFor(query))}
                  >
                    <Icon name="ph:clock" width={12} height={12} aria-hidden />
                    {query}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
        <RailSection title="Objectives" iconName="ph:target">
          <form
            className="role-surface-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              addObjective();
            }}
          >
            <input
              value={objectiveDraft}
              onChange={(e) => setObjectiveDraft(e.target.value)}
              placeholder="New objective…"
              aria-label="Add research objective"
            />
            <button type="submit" className="role-surface-chip focus-ring">Add</button>
          </form>
          {state.objectives.length === 0 ? (
            <SurfaceEmpty title="No active objectives." />
          ) : (
            <ul className="role-surface-list">
              {state.objectives.map((objective) => (
                <li key={objective.id} className="role-surface-list-row">
                  <label className={`role-surface-check${objective.done ? " role-surface-check--done" : ""}`}>
                    <input
                      type="checkbox"
                      checked={objective.done}
                      onChange={() =>
                        patch({
                          objectives: state.objectives.map((o) =>
                            o.id === objective.id ? { ...o, done: !o.done } : o,
                          ),
                        })
                      }
                    />
                    {objective.title}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
        <RailSection title="Saved investigations" iconName="ph:folder">
          <SurfaceEmpty
            title="No saved investigations."
            hint="Investigation snapshots land here once the daemon grows an archive API."
          />
        </RailSection>
      </SurfaceRail>

      <SurfaceCanvas label="Research canvas">
        <div className="role-surface-canvas-stack">
          <label className="role-surface-field">
            <span className="role-surface-field-label">Working notes</span>
            <textarea
              className="role-surface-notes"
              value={state.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="Scratchpad — notes, source comparison, document analysis…"
            />
          </label>
          <label className="role-surface-field">
            <span className="role-surface-field-label">Working hypotheses</span>
            <textarea
              className="role-surface-notes role-surface-notes--short"
              value={state.hypotheses}
              onChange={(e) => patch({ hypotheses: e.target.value })}
              placeholder="What do you currently believe, and why?"
            />
          </label>
        </div>
      </SurfaceCanvas>

      <SurfaceRail side="right" label="Evidence & context">
        <RailSection title="Collected evidence" iconName="ph:stack">
          {meanConfidence != null && (
            <p className="role-surface-metric">
              Mean confidence <strong>{meanConfidence}%</strong>
              {conflicts > 0 && <span className="role-surface-metric-warn"> · {conflicts} conflicting</span>}
            </p>
          )}
          <form
            className="role-surface-stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              addEvidence();
            }}
          >
            <input
              value={claimDraft}
              onChange={(e) => setClaimDraft(e.target.value)}
              placeholder="Claim…"
              aria-label="Evidence claim"
            />
            <input
              value={sourceDraft}
              onChange={(e) => setSourceDraft(e.target.value)}
              placeholder="Source URL (optional)"
              aria-label="Evidence source URL"
            />
            <button type="submit" className="role-surface-chip focus-ring">Collect</button>
          </form>
          {state.evidence.length === 0 ? (
            <SurfaceEmpty title="No evidence collected." />
          ) : (
            <ul className="role-surface-list">
              {state.evidence.map((evidence) => (
                <li key={evidence.id} className="role-surface-evidence">
                  <p>{evidence.claim}</p>
                  {evidence.sourceUrl && (
                    <button
                      type="button"
                      className="role-surface-row-btn focus-ring-inset"
                      onClick={() => context.openUrl(evidence.sourceUrl)}
                    >
                      <Icon name="ph:link" width={12} height={12} aria-hidden />
                      {evidence.sourceUrl}
                    </button>
                  )}
                  <div className="role-surface-evidence-meta">
                    <label>
                      Confidence {evidence.confidence}%
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={evidence.confidence}
                        onChange={(e) => setEvidence(evidence.id, { confidence: Number(e.target.value) })}
                      />
                    </label>
                    <label className="role-surface-check">
                      <input
                        type="checkbox"
                        checked={evidence.conflicting}
                        onChange={() => setEvidence(evidence.id, { conflicting: !evidence.conflicting })}
                      />
                      Conflicts
                    </label>
                    <button
                      type="button"
                      className="role-surface-icon-btn focus-ring"
                      aria-label="Discard evidence"
                      onClick={() => patch({ evidence: state.evidence.filter((e) => e.id !== evidence.id) })}
                    >
                      <Icon name="ph:trash" width={13} height={13} aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
        <RailSection title="Related memories" iconName="ph:note">
          {memories == null ? (
            <SurfaceEmpty title="Loading memories…" />
          ) : memories.length === 0 ? (
            <SurfaceEmpty title="No memories on file for this familiar." />
          ) : (
            <ul className="role-surface-list">
              {memories.map((memory) => (
                <li key={memory.fullPath} className="role-surface-memory">
                  <span className="role-surface-memory-path">{memory.relPath}</span>
                  {memory.excerpt && <span className="role-surface-memory-excerpt">{memory.excerpt}</span>}
                </li>
              ))}
            </ul>
          )}
        </RailSection>
        <RailSection title="Relevant conversations" iconName="ph:chat-circle-dots">
          {conversations.length === 0 ? (
            <SurfaceEmpty title="No conversations for this familiar yet." />
          ) : (
            <ul className="role-surface-list">
              {conversations.map((session) => (
                <li key={session.id}>
                  <button
                    type="button"
                    className="role-surface-row-btn focus-ring-inset"
                    onClick={() => context.openSession(session.id, context.activeFamiliar.id)}
                  >
                    {session.title || session.id}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
      </SurfaceRail>
    </SurfaceRoom>
  );
}
