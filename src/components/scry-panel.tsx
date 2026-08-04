"use client";

/**
 * ScryPanel — what is being pulled out of the likeness, while it is being
 * pulled (cave-3rz.3).
 *
 * A scry costs 12–18 s against a local vision harness. The rite used to show
 * one static line for all of it, which at that duration reads as a hang. This
 * panel replaces it with three things, in order of how much they matter:
 *
 *  1. **A real stage.** Every pip comes off an event the endpoint emitted when
 *     it actually reached that point (see `src/lib/scry-stream.ts`). Nothing
 *     advances on a timer, so a slow harness shows a long stage rather than a
 *     bar that has walked away from it.
 *  2. **The four slots, from the moment the image drops.** Name, role, offices,
 *     description are visible as empty shimmering placeholders before any of
 *     them arrive, so you can see WHAT is being extracted while you wait.
 *  3. **The harness's own words.** When it narrates mid-run — it usually does,
 *     around the six-second mark — that text is forwarded verbatim and shown.
 *     It is the one genuinely live signal that something is thinking.
 *
 * **Where the theatre is, precisely.** `coven run --stream-json` emits whole
 * assistant messages, not token deltas, and the reply arrives as one JSON
 * object. So the staggered landing below (200 ms apart) and the typed-in
 * description (~700 ms) are a reveal of data that has ALREADY arrived. That is
 * the last second of a twenty-second wait, and it is the only part of this
 * surface that is choreographed rather than observed. Asking the harness for
 * one message per field does stream genuinely — measured — but it cost 18.7 s
 * against 12.5 s for the single reply, so the fast path won.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/lib/icon";
import { FAMILIAR_TYPES } from "@/lib/familiar-types";
import { SCRY_STAGES, scryStageIndex, type ScryStage } from "@/lib/scry-stream";
import type { ScryState } from "@/lib/use-scry";

/** Landing order. Name first because it is the field the card shows biggest;
 *  description last because it is the one that takes the longest to read. */
const SLOTS = ["name", "role", "offices", "description"] as const;
type SlotKey = (typeof SLOTS)[number];

const SLOT_LABEL: Record<SlotKey, string> = {
  name: "Name",
  role: "Office",
  offices: "Sigils",
  description: "In a line",
};

/** Placeholder widths, so an empty slot reads as the shape of the thing that is
 *  coming rather than as four identical bars. */
const SLOT_WIDTH: Record<SlotKey, string> = {
  name: "scry-slot--short",
  role: "scry-slot--medium",
  offices: "scry-slot--medium",
  description: "scry-slot--long",
};

const STAGE_LABEL: Record<ScryStage, (harness: string) => string> = {
  picking: () => "Finding a harness that can see",
  harness: (h) => `${h} answered the call`,
  staged: () => "The likeness is on the slab",
  looking: (h) => `${h} is looking at it`,
  speaking: () => "It has started to speak",
  done: (h) => `${h} looked. Every guess below is editable.`,
};

/** One field per 200ms, then the description types itself in. Both numbers are
 *  bounded on purpose: see the honesty note in this file's header. */
const LANDING_STEP_MS = 200;
const TYPE_DURATION_MS = 700;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/** Seconds since the request left, so a long wait always shows it is alive —
 *  this is a readout, not an animation, and reduced motion keeps it. */
function useElapsed(startedAt: number | null, running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (startedAt == null) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed((performance.now() - startedAt) / 1000);
    tick();
    if (!running) return;
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [startedAt, running]);
  return elapsed;
}

export type ScryPanelProps = { scry: ScryState };

export function ScryPanel({ scry }: ScryPanelProps) {
  const reduced = useReducedMotion();
  const running = scry.status === "scrying";
  const elapsed = useElapsed(scry.startedAt, running);
  const harness = scry.harnessLabel ?? "The scry";

  // How many slots have been revealed. Driven by a chain of timers that only
  // starts once the values are in hand — it never runs while data is missing.
  const [landed, setLanded] = useState(0);
  const [typed, setTyped] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  const values = useMemo(() => {
    const s = scry.suggestions;
    return {
      name: s?.name ?? "",
      role: s?.role ?? "",
      offices: (s?.typeIds ?? [])
        .map((id) => FAMILIAR_TYPES.find((t) => t.id === id)?.label ?? id)
        .join(" · "),
      description: s?.description ?? "",
    } satisfies Record<SlotKey, string>;
  }, [scry.suggestions]);

  useEffect(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
    if (scry.status !== "done") {
      setLanded(0);
      setTyped(null);
      return;
    }
    if (reduced) {
      // No stagger, no typing: everything is already here, so show it.
      setLanded(SLOTS.length);
      setTyped(values.description);
      return;
    }
    for (let i = 0; i < SLOTS.length; i += 1) {
      timers.current.push(
        window.setTimeout(() => setLanded(i + 1), i * LANDING_STEP_MS),
      );
    }
    // The description writes itself in once its slot lights up. This is a
    // reveal of text already received, held to well under a second.
    const text = values.description;
    setTyped("");
    const start = (SLOTS.length - 1) * LANDING_STEP_MS;
    const steps = Math.max(1, Math.min(text.length, 48));
    for (let i = 1; i <= steps; i += 1) {
      const cut = Math.ceil((text.length * i) / steps);
      timers.current.push(
        window.setTimeout(
          () => setTyped(text.slice(0, cut)),
          start + (TYPE_DURATION_MS * i) / steps,
        ),
      );
    }
    return () => {
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current = [];
    };
  }, [reduced, scry.status, values]);

  const stageIndex = scry.stage ? scryStageIndex(scry.stage) : -1;
  const line = scry.status === "failed"
    ? `${scry.error ?? "The scry did not come back."} Fill the fields in yourself.`
    : scry.stage
      ? STAGE_LABEL[scry.stage](harness)
      : "Reaching for a harness";

  return (
    <section
      className={`scry${running ? " scry--running" : ""}${scry.status === "failed" ? " scry--failed" : ""}`}
      aria-label="Scrying the likeness"
    >
      <div className="scry__head">
        <ol className="scry__rail" aria-hidden>
          {SCRY_STAGES.map((stage, i) => (
            <li
              key={stage}
              className={`scry__pip${i <= stageIndex ? " scry__pip--lit" : ""}${
                stage === scry.stage && running ? " scry__pip--now" : ""
              }`}
            />
          ))}
        </ol>
        {/* Politeness matters here: the stage changes several times during a
            scry and the user is usually reading somewhere else on the page. */}
        <p className="scry__line" role="status">{line}</p>
        {scry.startedAt != null ? (
          <span className="scry__elapsed">{elapsed.toFixed(1)}s</span>
        ) : null}
      </div>

      {scry.murmur ? <p className="scry__murmur">“{scry.murmur}”</p> : null}

      <ul className="scry__slots">
        {SLOTS.map((key, i) => {
          const hasValue = landed > i && values[key].length > 0;
          const shown = key === "description" && typed != null ? typed : values[key];
          return (
            <li
              key={key}
              className={`scry-slot ${SLOT_WIDTH[key]}${hasValue ? " scry-slot--landed" : ""}`}
              data-scry-slot={key}
              data-scry-landed={hasValue ? "true" : "false"}
            >
              <span className="scry-slot__label">{SLOT_LABEL[key]}</span>
              <span className="scry-slot__value">
                {hasValue ? (
                  shown
                ) : landed > i ? (
                  <span className="scry-slot__none">nothing came back</span>
                ) : (
                  <span className="scry-slot__bar" aria-hidden />
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {scry.status === "failed" ? (
        <p className="scry__fallback">
          <Icon name="ph:warning" width={13} height={13} aria-hidden />
          The rite still summons — every field is yours to fill.
        </p>
      ) : null}
    </section>
  );
}
