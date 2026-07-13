"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  defaultResearchPlan,
  inferResearchMissionMode,
} from "@/lib/research-mission-routing";
import {
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

function boundNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export function ResearchMissionComposer({ familiarId, daemonRunning, onStart }: Props) {
  const { announce } = useAnnouncer();
  const [intent, setIntent] = useState("");
  const [mode, setMode] = useState<"auto" | ResearchMissionMode>("auto");
  const [bounds, setBounds] = useState<ResearchBounds>(defaultResearchPlan("brief").bounds);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inferred = useMemo(() => inferResearchMissionMode(intent), [intent]);
  const effectiveMode = mode === "auto" ? inferred.mode : mode;
  const plan = useMemo(() => defaultResearchPlan(effectiveMode), [effectiveMode]);

  useEffect(() => {
    setBounds({ ...plan.bounds });
  }, [plan]);

  const updateBound = <K extends keyof ResearchBounds>(key: K, value: ResearchBounds[K]) => {
    setBounds((current) => ({ ...current, [key]: value }));
  };

  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = intent.trim();
    if (!trimmed || submitting) return;
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
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "research-mission-error" : "research-plan-review"}
        />
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
          disabled={!intent.trim()}
        >
          Start research
        </Button>
      </div>

      <div id="research-plan-review" className="research-plan-review">
        <span className="research-plan-chip research-plan-chip--mode">{MODE_LABELS[effectiveMode]}</span>
        <span className="research-plan-chip">
          {mode === "auto" ? inferred.reason : "Selected manually"}
        </span>
        <span className="research-plan-chip">{plan.deliverables.join(" + ")}</span>
        <span className="research-plan-chip">{bounds.maxIterations} iteration{bounds.maxIterations === 1 ? "" : "s"}</span>
        <span className="research-plan-chip">{bounds.wallClockMinutes} min</span>
        <span className="research-plan-chip">{bounds.sourceTarget} sources</span>
      </div>

      <details className="research-bounds-disclosure">
        <summary>Review bounds</summary>
        <div className="research-bounds-grid">
          <label>
            <span>Minutes</span>
            <input
              type="number"
              min={1}
              max={1440}
              value={bounds.wallClockMinutes}
              onChange={(event) => updateBound("wallClockMinutes", boundNumber(event.target.value, 1))}
            />
          </label>
          <label>
            <span>Iterations</span>
            <input
              type="number"
              min={1}
              max={100}
              value={bounds.maxIterations}
              onChange={(event) => {
                const maxIterations = boundNumber(event.target.value, 1);
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
              type="number"
              min={1}
              max={500}
              value={bounds.sourceTarget}
              onChange={(event) => updateBound("sourceTarget", boundNumber(event.target.value, 1))}
            />
          </label>
          <label>
            <span>Checkpoint every</span>
            <input
              type="number"
              min={1}
              max={bounds.maxIterations}
              value={bounds.checkpointEvery}
              onChange={(event) => updateBound("checkpointEvery", boundNumber(event.target.value, 1))}
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
