"use client";

/**
 * Evidence inspector (Unit 2, cave-6sles.11): for each TopicEvidenceRefV1,
 * shows the resolved (resourceId, selector) coordinates and the exact excerpt.
 * Read-only — no pack blob bytes are fetched over HTTP; the excerpt already
 * lives on the proposal.
 */

import type { TopicEvidenceRefV1 } from "@/lib/research-protocol/topic-discovery";

export type ResearchTopicEvidenceProps = {
  refs: readonly TopicEvidenceRefV1[];
  label: string;
};

function selectorLabel(selector: TopicEvidenceRefV1["selector"]): string {
  switch (selector.type) {
    case "whole-resource":
      return "whole resource";
    case "text-span":
      return `bytes ${selector.start}–${selector.end}`;
    case "json-pointer":
      return `pointer ${selector.pointer}`;
    case "turn-range":
      return `turns ${selector.start}–${selector.end}`;
    case "markdown-section":
      return `section ${selector.headingPath.join(" / ")}`;
    case "pdf-page-span":
      return `page ${selector.page} · ${selector.start}–${selector.end}`;
  }
}

export function ResearchTopicEvidence({ refs, label }: ResearchTopicEvidenceProps) {
  if (refs.length === 0) return null;
  return (
    <div className="research-topic-evidence" data-testid="research-topic-evidence">
      <span className="research-topic-evidence__label">{label}</span>
      {refs.map((ref, index) => (
        <figure key={`${ref.resourceId}-${index}`} className="research-topic-evidence__ref">
          <figcaption>
            <code>{ref.resourceId}</code> · <span>{selectorLabel(ref.selector)}</span>
          </figcaption>
          <blockquote>{ref.excerpt}</blockquote>
        </figure>
      ))}
    </div>
  );
}
