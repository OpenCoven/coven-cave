"use client";

/**
 * AutoModeFeedbackModal — the short questionnaire shown when a `/auto` mission
 * ends (auto-status-blocks.ts detects the marker; chat-view.tsx opens this
 * modal). Answers post to /api/auto-mode/feedback, which folds recent notes
 * into a digest (buildPreferenceDigest, auto-mode-preferences.ts) that rides
 * the NEXT mission's directive — this is the "training" loop.
 *
 * Two deliberate shapes here, both about getting usable data rather than
 * pretty data:
 *
 * 1. It rates HOW THE FAMILIAR WORKED, not how the deliverable turned out. A
 *    grim refactor of legacy code can earn two stars for reasons that have
 *    nothing to do with the familiar's judgement — and since these answers
 *    steer future missions, an outcome rating would teach it to change
 *    behaviour that was never the problem.
 *
 * 2. Tags carry the load; prose is optional. The human just came back to a
 *    finished mission and is being asked for homework. Three blank text areas
 *    read as a wall and get skipped, taking the whole signal with them, so the
 *    fast path is one tap and everything else is opt-in.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useAnnouncer } from "@/components/ui/live-region";

type AutoModeFeedbackModalProps = {
  open: boolean;
  onClose: () => void;
  familiarId: string;
  mission: string;
  /** How the mission ended — the questionnaire must not congratulate a stall. */
  outcome?: "done" | "failed" | "timed-out" | "cancelled" | null;
};

/**
 * Process tags. Pre-written options beat a blank box: they are one tap, they
 * come back aggregable instead of as free prose, and they prompt honesty from
 * someone who would otherwise type nothing at all.
 */
const TAGS: ReadonlyArray<{ id: string; label: string; good: boolean }> = [
  { id: "nailed-it", label: "Nailed the goal", good: true },
  { id: "good-questions", label: "Asked the right questions", good: true },
  { id: "good-judgement", label: "Good calls when unsure", good: true },
  { id: "clear-summary", label: "Clear summary", good: true },
  { id: "missed-goal", label: "Misread the goal", good: false },
  { id: "too-many-questions", label: "Asked too much up front", good: false },
  { id: "over-scoped", label: "Did more than I asked", good: false },
  { id: "under-delivered", label: "Left it unfinished", good: false },
  { id: "should-have-asked", label: "Should have checked with me", good: false },
];

function outcomeCopy(outcome: AutoModeFeedbackModalProps["outcome"]): { crumb: string; lead: string } {
  switch (outcome) {
    case "failed":
      return { crumb: "What happened?", lead: "It couldn't finish. What it does next time depends on what you say here." };
    case "timed-out":
      return { crumb: "It went quiet", lead: "No sign-off came back, so the mission was closed out. Rate what you did see." };
    case "cancelled":
      return { crumb: "You ended it", lead: "Worth saying why — that is the part it can actually learn from." };
    default:
      return { crumb: "How'd it go?", lead: "This is how your familiar learns your taste. Even just a rating helps." };
  }
}

export function AutoModeFeedbackModal({ open, onClose, familiarId, mission, outcome }: AutoModeFeedbackModalProps) {
  const { announce } = useAnnouncer();
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = outcomeCopy(outcome);
  const negative = tags.some((id) => TAGS.find((t) => t.id === id)?.good === false);
  // "What would you change?" only earns its place when something went wrong.
  // Asking it of someone who just gave five stars is friction with no answer.
  const wantsCorrection = (rating > 0 && rating <= 3) || negative || outcome === "failed" || outcome === "timed-out";

  const toggleTag = (id: string) =>
    setTags((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));

  const reset = () => {
    setRating(0);
    setTags([]);
    setNote("");
    setError(null);
  };

  const skip = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (rating < 1) {
      setError("Pick a rating so this mission's feedback counts.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Tags split by polarity into the same liked/disliked fields the digest
      // already reads, so the store keeps one shape regardless of how the
      // human answered.
      const label = (id: string) => TAGS.find((t) => t.id === id)?.label ?? id;
      const liked = tags.filter((id) => TAGS.find((t) => t.id === id)?.good).map(label).join(", ");
      const tagged = tags.filter((id) => TAGS.find((t) => t.id === id)?.good === false).map(label).join(", ");
      const disliked = wantsCorrection ? [tagged, note.trim()].filter(Boolean).join(" — ") : tagged;
      const res = await fetch("/api/auto-mode/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiarId,
          mission,
          rating,
          liked,
          disliked,
          freeform: wantsCorrection ? "" : note.trim(),
        }),
      });
      if (!res.ok) {
        setError("Couldn't save feedback — try again.");
        return;
      }
      announce("Feedback saved — your familiar will factor this into future missions.", "polite");
      reset();
      onClose();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "focus-ring w-full rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-sunken)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]";

  return (
    <Modal
      open={open}
      onClose={skip}
      breadcrumb={["Auto mission", copy.crumb]}
      footerActions={
        <>
          <Button variant="secondary" size="sm" onClick={skip}>
            Skip
          </Button>
          <Button variant="primary" size="sm" onClick={() => void submit()} disabled={saving}>
            {saving ? "Saving…" : "Save feedback"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Why-this-matters leads, rather than trailing in fine print: someone
            deciding whether to answer decides before they read the bottom. */}
        <p className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">{copy.lead}</p>
        <p className="min-w-0 truncate text-[length:var(--text-xs)] text-[var(--text-muted)]" title={mission}>
          Mission: {mission}
        </p>
        {error ? (
          <p className="text-sm text-[var(--color-warning)]" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          How well did it handle the mission?
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating, 1 to 5 stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                className="focus-ring rounded p-0.5"
                onClick={() => setRating(n)}
              >
                <span
                  aria-hidden
                  className={`text-lg leading-none ${n <= rating ? "text-[var(--accent-presence)]" : "text-[var(--text-muted)]"}`}
                >
                  {n <= rating ? "\u2605" : "\u2606"}
                </span>
              </button>
            ))}
          </div>
        </div>
        <fieldset className="flex flex-col gap-1.5 text-xs text-[var(--text-muted)]">
          <legend className="mb-1">Anything ring true? (optional)</legend>
          <div className="flex flex-wrap gap-1.5">
            {TAGS.map((tag) => {
              const on = tags.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleTag(tag.id)}
                  className={`focus-ring rounded-full border px-2.5 py-1 text-[length:var(--text-xs)] transition-colors ${
                    on
                      ? "border-[color-mix(in_oklch,var(--accent-presence)_40%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_14%,transparent)] text-[var(--accent-presence)]"
                      : "border-[var(--border-hairline)] text-[var(--text-secondary)]"
                  }`}
                >
                  {tag.label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          {wantsCorrection ? "What should it do differently?" : "Anything to add?"}
          <textarea
            className={`${inputClass} min-h-16 resize-y`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional"
          />
        </label>
        <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
          Shapes the next /auto mission — nothing here changes this one.
        </p>
      </div>
    </Modal>
  );
}
