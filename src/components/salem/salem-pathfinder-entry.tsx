"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import { SalemPathfinderCard } from "./salem-pathfinder-card";
import type {
  SalemPathfinderCard as SalemPathfinderCardData,
  SalemPathfinderMode,
  SalemPathfinderRequest,
} from "@/lib/salem/pathfinder-types";

// Shared "Ask Salem" entry control used at setup and home entry points. Gathers
// the caller-provided safe context, posts a SalemPathfinderRequest to the
// deterministic pathfinder route, and renders the resulting card at the
// requested density. The caller wires mode-appropriate handlers (run-doctor at
// setup, save-to-board + route at home); honest UI hides actions without a wired
// handler (see SalemPathfinderCard).

type Props = {
  mode: SalemPathfinderMode;
  density?: "full" | "slim";
  label?: string;
  defaultMessage?: string;
  machineState?: SalemPathfinderRequest["machineState"];
  caveState?: SalemPathfinderRequest["caveState"];
  currentSurface?: SalemPathfinderRequest["currentSurface"];
  onRunDoctor?: () => void;
  onRoute?: (target: string) => void;
  onSave?: (card: SalemPathfinderCardData) => void;
};

export function SalemPathfinderEntry({
  mode,
  density = mode === "setup" ? "slim" : "full",
  label = mode === "setup" ? "Ask Salem for the next step" : "Find your next path",
  defaultMessage = "",
  machineState,
  caveState,
  currentSurface,
  onRunDoctor,
  onRoute,
  onSave,
}: Props) {
  const [message, setMessage] = useState(defaultMessage);
  const [card, setCard] = useState<SalemPathfinderCardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const ask = async () => {
    if (loading) return;
    setLoading(true);
    setError(false);
    try {
      const body: SalemPathfinderRequest = {
        mode,
        userMessage: message.trim() || defaultMessage || "help me choose where to start",
        currentSurface,
        machineState,
        caveState,
      };
      const res = await fetch("/api/salem/pathfinder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { card?: SalemPathfinderCardData };
      if (data.card) setCard(data.card);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="salem-pf-entry" data-mode={mode}>
      <div className="salem-pf-entry__row">
        <Icon name="ph:sparkle" width={14} className="salem-pf-entry__glyph" aria-hidden />
        <input
          className="salem-pf-entry__input"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void ask(); }}
          placeholder={mode === "setup" ? "Stuck? Describe what you're trying to do…" : "What do you want to do next?"}
          aria-label={label}
          disabled={loading}
        />
        <button type="button" className="salem-pf-entry__go" onClick={() => void ask()} disabled={loading}>
          {loading ? "Asking…" : label}
        </button>
      </div>

      {error ? (
        <p className="salem-pf-entry__error">Salem couldn&rsquo;t map that to a path. Try rephrasing.</p>
      ) : null}

      {card ? (
        <div className="salem-pf-entry__card">
          <SalemPathfinderCard
            card={card}
            density={density}
            onRunDoctor={onRunDoctor}
            onRoute={onRoute}
            onSave={onSave}
          />
        </div>
      ) : null}
    </div>
  );
}
