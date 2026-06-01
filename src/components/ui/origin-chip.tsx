"use client";

import { Icon } from "@/lib/icon";
import type { SessionOrigin } from "@/lib/types";
import { ORIGIN_ICON, ORIGIN_LABEL } from "@/lib/session-origin";

type Props = {
  origin: SessionOrigin;
  /** Optional delegation chain — e.g. `from: "sage"` renders as "call · from sage". */
  from?: string;
  /** Subject reference for cross-familiar surfacing — e.g. "about: cody". */
  about?: string;
  /** When true, hide the text label and keep only the icon. */
  iconOnly?: boolean;
  className?: string;
};

export function OriginChip({ origin, from, about, iconOnly, className }: Props) {
  const label = ORIGIN_LABEL[origin];
  const icon = ORIGIN_ICON[origin];
  const tooltipParts = [label];
  if (from) tooltipParts.push(`from ${from}`);
  if (about) tooltipParts.push(`about ${about}`);
  const tooltip = tooltipParts.join(" · ");
  return (
    <span
      className={`ui-origin-chip${className ? ` ${className}` : ""}`}
      title={tooltip}
      data-origin={origin}
    >
      <Icon name={icon} width={11} height={11} aria-hidden />
      {iconOnly ? (
        <span className="sr-only">{tooltip}</span>
      ) : (
        <span className="ui-origin-chip-label">
          {label}
          {from ? <span className="ui-origin-chip-suffix"> · from {from}</span> : null}
          {about ? <span className="ui-origin-chip-suffix"> · about {about}</span> : null}
        </span>
      )}
    </span>
  );
}
