"use client";

import { Icon, type IconName } from "@/lib/icon";
import { sessionInitiatorLabel } from "@/lib/session-initiator";
import type { SessionInitiator } from "@/lib/types";

type Props = {
  initiator?: SessionInitiator;
  iconOnly?: boolean;
  className?: string;
};

const ICONS: Record<SessionInitiator["kind"], IconName> = {
  human: "ph:user",
  familiar: "ph:sparkle",
  system: "ph:gear-six",
  unknown: "ph:info",
};

export function SessionInitiatorChip({ initiator, iconOnly, className }: Props) {
  const safeInitiator = initiator ?? { kind: "unknown", label: "Unknown" };
  const label = sessionInitiatorLabel(safeInitiator);
  const tooltip = `Started by ${label}`;

  return (
    <span
      className={`ui-initiator-chip${className ? ` ${className}` : ""}`}
      data-initiator={safeInitiator.kind}
      title={tooltip}
      aria-label={tooltip}
    >
      <Icon name={ICONS[safeInitiator.kind]} width={11} height={11} aria-hidden />
      {iconOnly ? (
        <span className="sr-only">{tooltip}</span>
      ) : (
        <span className="ui-initiator-chip-label">Started by {label}</span>
      )}
    </span>
  );
}
