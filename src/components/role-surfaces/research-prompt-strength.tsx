"use client";

/**
 * Prompt strength meter — five segments, a tone word, and what is missing.
 *
 * Shared by the composer footer and the prompt builder header so both read the
 * same score. Colour is never the only channel: the tone word and the "add: …"
 * line carry the same information in text.
 */

import type { ResearchPromptStrength } from "@/lib/research-prompt-brief";

export function ResearchPromptStrengthMeter({
  strength,
  showMissing = false,
}: {
  strength: ResearchPromptStrength;
  /** Render the "add: …" tail (composer footer does; the dialog header does not). */
  showMissing?: boolean;
}) {
  return (
    <span className="research-strength" title={strength.tip} data-tone={strength.tone}>
      <span className="research-strength__segs" aria-hidden>
        {strength.parts.map((part, index) => (
          <i key={part.key} data-on={index < strength.score} />
        ))}
      </span>
      <span className="research-strength__label">{strength.label}</span>
      <span className="sr-only">{strength.tip}</span>
      {showMissing && strength.missing.length > 0 ? (
        <span className="research-strength__missing">
          add: {strength.missing.slice(0, 3).join(" · ")}
        </span>
      ) : null}
    </span>
  );
}
