"use client";

/**
 * Prompt builder — the handoff's "Structure the question" dialog.
 *
 * Five stacked fields on the left, a live assembled preview plus coaching on
 * the right. Everything is pure text (src/lib/research-prompt-brief.ts); Apply
 * hands the assembled prompt back to the composer, which owns the textarea.
 *
 * Opening it parses whatever is already in the composer, so a hand-typed
 * prompt lands in `question` and the builder becomes a way to add the four
 * missing elements rather than a blank restart.
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  RESEARCH_BRIEF_FIELDS,
  assembleBrief,
  builderCoach,
  parseBrief,
  promptStrength,
  type ResearchBrief,
  type ResearchBriefKey,
} from "@/lib/research-prompt-brief";
import { ResearchPromptStrengthMeter } from "./research-prompt-strength";

type Props = {
  open: boolean;
  /** Composer text the builder opens against. */
  draft: string;
  onClose(): void;
  onApply(prompt: string, filled: number): void;
};

export function ResearchPromptBuilder({ open, draft, onClose, onApply }: Props) {
  const [brief, setBrief] = useState<ResearchBrief>(() => parseBrief(draft));

  // Re-seed each time the dialog opens — not on every draft keystroke, which
  // would fight the user typing in the builder's own fields.
  useEffect(() => {
    if (open) setBrief(parseBrief(draft));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open edge only
  }, [open]);

  const preview = useMemo(() => assembleBrief(brief), [brief]);
  const filled = RESEARCH_BRIEF_FIELDS.filter((field) => brief[field.key].trim()).length;
  const strength = useMemo(() => promptStrength(preview), [preview]);

  const set = (key: ResearchBriefKey, value: string) =>
    setBrief((current) => ({ ...current, [key]: value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      ariaLabel="Prompt builder"
      footerPills={
        <span className="research-builder__foot">
          Slash commands (/goal, /constraint…) do the same inline.
        </span>
      }
      footerActions={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!preview.trim()}
            onClick={() => onApply(preview, filled)}
          >
            Apply to composer
          </Button>
        </>
      }
    >
      <div className="research-builder">
        <header className="research-builder__head">
          <span className="research-builder__glyph" aria-hidden>✦</span>
          <span className="research-builder__titles">
            <span className="research-builder__kicker">Prompt builder</span>
            <strong>Structure the question — better bounds, better evidence</strong>
          </span>
          <ResearchPromptStrengthMeter strength={strength} />
        </header>

        <div className="research-builder__body">
          <div className="research-builder__fields">
            {RESEARCH_BRIEF_FIELDS.map((field) => {
              const value = brief[field.key];
              const isFilled = Boolean(value.trim());
              const inputId = `research-builder-${field.key}`;
              return (
                <div key={field.key} className="research-builder__field" data-filled={isFilled}>
                  <div className="research-builder__field-head">
                    <span className="research-builder__badge" aria-hidden>{field.badge}</span>
                    <label htmlFor={inputId}>{field.label}</label>
                    <span className="research-builder__hint">{field.hint}</span>
                    <span className="research-builder__state">
                      {isFilled ? "✓" : "optional"}
                    </span>
                  </div>
                  <textarea
                    id={inputId}
                    value={value}
                    rows={field.rows}
                    placeholder={field.placeholder}
                    onChange={(event) => set(field.key, event.target.value)}
                  />
                  {field.chips.length > 0 && !isFilled ? (
                    <div className="research-builder__chips">
                      {field.chips.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          className="research-builder__chip focus-ring"
                          onClick={() => set(field.key, chip)}
                        >
                          + {chip}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <aside className="research-builder__aside">
            <span className="research-builder__aside-label">Assembled prompt</span>
            <pre className="research-builder__preview">
              {preview || "Your structured prompt appears here as you fill the fields."}
            </pre>
            <div className="research-builder__coach">
              <span className="research-builder__coach-label">Why structure matters</span>
              <p>{builderCoach(filled)}</p>
            </div>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
