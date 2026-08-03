"use client";

/**
 * AutoModeFeedbackModal — the short questionnaire shown when a `/auto`
 * mission reports `<coven:auto-status state="done">` (auto-status-blocks.ts
 * detects the marker; chat-view.tsx opens this modal). Answers post to
 * /api/auto-mode/feedback, which folds recent liked/disliked notes into a
 * digest (buildPreferenceDigest, auto-mode-preferences.ts) that rides the
 * NEXT mission's directive — this is the "training" loop.
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
};

export function AutoModeFeedbackModal({ open, onClose, familiarId, mission }: AutoModeFeedbackModalProps) {
  const { announce } = useAnnouncer();
  const [rating, setRating] = useState(0);
  const [liked, setLiked] = useState("");
  const [disliked, setDisliked] = useState("");
  const [freeform, setFreeform] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setRating(0);
    setLiked("");
    setDisliked("");
    setFreeform("");
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
      const res = await fetch("/api/auto-mode/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familiarId, mission, rating, liked, disliked, freeform }),
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
      breadcrumb={["Auto mission", "How'd it go?"]}
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
        <p className="min-w-0 truncate text-[length:var(--text-xs)] text-[var(--text-muted)]" title={mission}>
          Mission: {mission}
        </p>
        {error ? (
          <p className="text-sm text-[var(--color-warning)]" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          Rate the final result
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
        <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          What did you like?
          <textarea
            className={`${inputClass} min-h-16 resize-y`}
            value={liked}
            onChange={(e) => setLiked(e.target.value)}
            placeholder="Optional — what should it keep doing?"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          What would you change?
          <textarea
            className={`${inputClass} min-h-16 resize-y`}
            value={disliked}
            onChange={(e) => setDisliked(e.target.value)}
            placeholder="Optional — what should it avoid next time?"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          Anything else
          <textarea
            className={`${inputClass} min-h-16 resize-y`}
            value={freeform}
            onChange={(e) => setFreeform(e.target.value)}
            placeholder="Optional"
          />
        </label>
        <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
          This shapes how your familiar approaches the next /auto mission — nothing here changes this one.
        </p>
      </div>
    </Modal>
  );
}
