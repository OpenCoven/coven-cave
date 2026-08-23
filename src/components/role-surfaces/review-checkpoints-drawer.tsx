"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { relativeTime } from "@/lib/relative-time";
import {
  createReviewRequestGate,
  parseCheckpointEnvelope,
  type ReviewCheckpoint,
} from "./review-deck";
import { SurfaceError } from "./surface-room";

export function ReviewCheckpointsDrawer({
  projectRoot,
  selectedScope,
  open,
  onToggle,
}: {
  projectRoot: string;
  selectedScope: string;
  open: boolean;
  onToggle: () => void;
}) {
  const [checkpoints, setCheckpoints] = useState<ReviewCheckpoint[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const requests = useRef(createReviewRequestGate());
  const latestScope = useRef(selectedScope);
  latestScope.current = selectedScope;

  const loadCheckpoints = useCallback(async () => {
    const request = requests.current.begin(selectedScope);
    setCheckpoints(null);
    setError(null);
    if (!open) return;
    try {
      const response = await fetch(
        `/api/changes?projectRoot=${encodeURIComponent(projectRoot)}&checkpoints=1`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("checkpoint request failed");
      const json = await response.json();
      if (!requests.current.isCurrent(request, latestScope.current)) return;
      setCheckpoints(parseCheckpointEnvelope(json));
    } catch {
      if (!requests.current.isCurrent(request, latestScope.current)) return;
      setError("Couldn't load checkpoints.");
      setCheckpoints(null);
    }
  }, [open, projectRoot, selectedScope]);

  useEffect(() => {
    void loadCheckpoints();
    return () => requests.current.invalidate();
  }, [loadCheckpoints]);

  return (
    <section className="rd-panel rd-checkpoints" aria-label="Local checkpoints">
      <button
        type="button"
        className="rd-cp-toggle focus-ring"
        aria-expanded={open}
        aria-controls="rd-checkpoints"
        onClick={onToggle}
      >
        <Icon name="ph:clock-counter-clockwise" width={14} height={14} aria-hidden />
        <span className="rd-eyebrow">Local checkpoints</span>
        <span>{open ? "Hide" : "Browse saved patches"}</span>
      </button>
      {open ? (
        <div id="rd-checkpoints" className="rd-cp-list rd-scroll">
          {error ? (
            <SurfaceError
              title={error}
              hint="Check the project, then retry."
              onRetry={loadCheckpoints}
            />
          ) : checkpoints == null ? (
            <span className="rd-cp-summary">Loading checkpoints…</span>
          ) : checkpoints.length === 0 ? (
            <span className="rd-cp-summary">
              No checkpoints saved. Chat change tools snapshot working trees here before risky edits.
            </span>
          ) : (
            checkpoints.map((checkpoint) => (
              <span
                key={checkpoint.name}
                className="rd-cp-pill"
                title={checkpoint.name}
              >
                <span className="rd-cp-name">
                  {checkpoint.name.replace(/\.patch$/, "")}
                </span>
                <span className="rd-cp-date">
                  {relativeTime(checkpoint.savedAt)}
                </span>
              </span>
            ))
          )}
          <span className="rd-cp-summary">
            Read-only — the Review Deck never applies a patch.
          </span>
        </div>
      ) : null}
    </section>
  );
}
