"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  defaultResearchPlan,
  inferResearchMissionMode,
} from "@/lib/research-mission-routing";
import {
  RESEARCH_BOUND_LIMITS,
  RESEARCH_INTENT_MIN_LENGTH,
  RESEARCH_MISSION_MODES,
  type CreateResearchMissionInput,
  type ResearchBounds,
  type ResearchMission,
  type ResearchMissionMode,
} from "@/lib/research-missions";

type StartResult =
  | { ok: true; mission: ResearchMission }
  | { ok: false; error: string };

type Props = {
  familiarId: string;
  daemonRunning: boolean;
  onStart(input: CreateResearchMissionInput): Promise<StartResult>;
};

const MODE_LABELS: Record<ResearchMissionMode, string> = {
  brief: "Brief",
  sweep: "Sweep",
  paper: "Paper",
  autoresearch: "Autoresearch",
};

function boundNumber(value: string, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

export function ResearchMissionComposer({ familiarId, daemonRunning, onStart }: Props) {
  const { announce } = useAnnouncer();
  const [intent, setIntent] = useState("");
  const [mode, setMode] = useState<"auto" | ResearchMissionMode>("auto");
  const [bounds, setBounds] = useState<ResearchBounds>(defaultResearchPlan("brief").bounds);
  const [boundsOpen, setBoundsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inferred = useMemo(() => inferResearchMissionMode(intent), [intent]);
  const effectiveMode = mode === "auto" ? inferred.mode : mode;
  const plan = useMemo(() => defaultResearchPlan(effectiveMode), [effectiveMode]);
  const trimmedIntent = intent.trim();
  const intentTooShort = trimmedIntent.length > 0 && trimmedIntent.length < RESEARCH_INTENT_MIN_LENGTH;

  useEffect(() => {
    setBounds({ ...plan.bounds });
  }, [plan]);

  const updateBound = <K extends keyof ResearchBounds>(key: K, value: ResearchBounds[K]) => {
    setBounds((current) => ({ ...current, [key]: value }));
  };

  // A bound chip is a shortcut into the Review-bounds disclosure: open it,
  // then focus the matching input once it is visible.
  const focusBound = (inputId: string) => {
    setBoundsOpen(true);
    requestAnimationFrame(() => document.getElementById(inputId)?.focus());
  };

  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = intent.trim();
    if (trimmed.length < RESEARCH_INTENT_MIN_LENGTH || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await onStart({
        familiarId,
        intent: trimmed,
        mode: effectiveMode,
        modeSource: mode === "auto" ? "auto" : "user",
        deliverable: plan.deliverables.join(" + "),
        bounds,
      });
      if (!result.ok) {
        setError(result.error);
        announce(result.error);
        return;
      }
      setIntent("");
      announce(`Started ${result.mission.title}.`);
    } catch {
      setError("Research could not start. Check the runtime and try again.");
      announce("Research could not start.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="research-mission-composer" onSubmit={start}>
      <div className="research-mission-composer__prompt">
        <label htmlFor="research-intent">What should we investigate?</label>
        <textarea
          id="research-intent"
          value={intent}
          onChange={(event) => setIntent(event.target.value)}
          placeholder="Compare approaches, map a field, draft a paper, or run bounded experiments…"
          rows={3}
          aria-invalid={Boolean(error) || intentTooShort}
          aria-describedby={error
            ? "research-mission-error"
            : intentTooShort
              ? "research-intent-minimum"
              : "research-plan-review"}
        />
        {intentTooShort ? (
          <p id="research-intent-minimum" className="research-intent-minimum">
            Add at least {RESEARCH_INTENT_MIN_LENGTH} characters so the familiar has a real question to investigate.
          </p>
        ) : null}
      </div>

      <div className="research-mission-composer__controls">
        <label className="research-mission-mode">
          <span>Mode</span>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as "auto" | ResearchMissionMode)}
          >
            <option value="auto">Auto</option>
            {RESEARCH_MISSION_MODES.map((value) => (
              <option key={value} value={value}>{MODE_LABELS[value]}</option>
            ))}
          </select>
        </label>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          leadingIcon="ph:play"
          loading={submitting}
          disabled={trimmedIntent.length < RESEARCH_INTENT_MIN_LENGTH}
        >
          Start research
        </Button>
      </div>

      <div id="research-plan-review" className="research-plan-review">
        <span className="research-plan-chip research-plan-chip--mode">{MODE_LABELS[effectiveMode]}</span>
        <span className="research-plan-chip research-plan-chip--note">
          {mode === "auto" ? inferred.reason : "Selected manually"}
        </span>
        <span className="research-plan-chip">{plan.deliverables.join(" + ")}</span>
        <button
          type="button"
          className="research-plan-chip"
          title="Edit in Review bounds"
          onClick={() => focusBound("research-bound-iterations")}
        >
          {bounds.maxIterations} iteration{bounds.maxIterations === 1 ? "" : "s"}
        </button>
        <button
          type="button"
          className="research-plan-chip"
          title="Edit in Review bounds"
          onClick={() => focusBound("research-bound-minutes")}
        >
          {bounds.wallClockMinutes} min
        </button>
        <button
          type="button"
          className="research-plan-chip"
          title="Edit in Review bounds"
          onClick={() => focusBound("research-bound-sources")}
        >
          {bounds.sourceTarget} sources
        </button>
      </div>

      <details
        className="research-bounds-disclosure"
        open={boundsOpen}
        onToggle={(event) => setBoundsOpen(event.currentTarget.open)}
      >
        <summary>Review bounds</summary>
        <div className="research-bounds-grid">
          <label>
            <span>Minutes</span>
            <input
              id="research-bound-minutes"
              type="number"
              min={1}
              max={RESEARCH_BOUND_LIMITS.wallClockMinutes}
              value={bounds.wallClockMinutes}
              onChange={(event) => updateBound("wallClockMinutes", boundNumber(event.target.value, 1, RESEARCH_BOUND_LIMITS.wallClockMinutes))}
            />
          </label>
          <label>
            <span>Iterations</span>
            <input
              id="research-bound-iterations"
              type="number"
              min={1}
              max={RESEARCH_BOUND_LIMITS.maxIterations}
              value={bounds.maxIterations}
              onChange={(event) => {
                const maxIterations = boundNumber(event.target.value, 1, RESEARCH_BOUND_LIMITS.maxIterations);
                setBounds((current) => ({
                  ...current,
                  maxIterations,
                  checkpointEvery: Math.min(current.checkpointEvery, maxIterations),
                }));
              }}
            />
          </label>
          <label>
            <span>Source target</span>
            <input
              id="research-bound-sources"
              type="number"
              min={1}
              max={RESEARCH_BOUND_LIMITS.sourceTarget}
              value={bounds.sourceTarget}
              onChange={(event) => updateBound("sourceTarget", boundNumber(event.target.value, 1, RESEARCH_BOUND_LIMITS.sourceTarget))}
            />
          </label>
          <label>
            <span>Checkpoint every</span>
            <input
              type="number"
              min={1}
              max={bounds.maxIterations}
              value={bounds.checkpointEvery}
              onChange={(event) => updateBound("checkpointEvery", boundNumber(event.target.value, 1, bounds.maxIterations))}
            />
          </label>
        </div>
      </details>

      {!daemonRunning ? (
        <p className="research-runtime-note">
          The local daemon is offline. Travel mode may queue this mission; otherwise it will stay retryable.
        </p>
      ) : null}
      {error ? <p id="research-mission-error" className="research-mission-error" role="alert">{error}</p> : null}
    </form>
  );
}
