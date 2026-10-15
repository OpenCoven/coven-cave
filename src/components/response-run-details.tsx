import "@/styles/response-run-details.css";
import { Icon } from "@/lib/icon";
import type { ChatResponseMetadata } from "@/lib/chat-response-metadata";
import { responseRunDetails } from "@/lib/chat-run-details";

/** Run details (#6026, a slice of #5765): the model application trail, the
 *  per-turn control outcome and the activity support that used to render as
 *  up to nine hairline pills under every reply. Static provenance is muted
 *  text, not a pill (design language §8), so the whole trail sits behind one
 *  native disclosure. Its closed line names the runtime, the model state when
 *  it is not applied, and how many facts the runtime did not report or
 *  confirm, so a gap stays visible without opening it. Inside, every line the
 *  pills carried, grouped and aligned as label/value rows. */
export function ResponseRunDetails({ metadata }: { metadata?: ChatResponseMetadata }) {
  const details = responseRunDetails(metadata);
  if (!details) return null;
  return (
    <details
      className="cave-run-details"
      data-turn-run-details={true}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key !== "Escape" || !keyEvent.currentTarget.open) return;
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        keyEvent.currentTarget.open = false;
        keyEvent.currentTarget.querySelector("summary")?.focus();
      }}
    >
      <summary className="focus-ring">
        <Icon name="ph:caret-right" width={12} className="cave-run-details__caret" aria-hidden />
        <span className="cave-run-details__title">Run details</span>
        {/* Real " · " separators, not CSS content: the summary's text is its
            accessible name and what a copy or a test reads. */}
        {details.facts.map((fact) => (
          <span key={fact}>{" · "}{fact}</span>
        ))}
      </summary>
      <dl className="cave-run-details__list">
        {details.groups.map((group) => (
          <div key={group.id} className="cave-run-details__group" data-run-details-group={group.id} aria-label={group.label}>
            {group.lines.map((line) => (
              <div key={`${line.label ?? ""}:${line.value}`} className="cave-run-details__row" data-gap={line.gap || undefined}>
                {line.label ? <dt>{line.label}</dt> : null}
                <dd className={line.label ? undefined : "cave-run-details__note"}>{line.value}</dd>
              </div>
            ))}
          </div>
        ))}
      </dl>
    </details>
  );
}
