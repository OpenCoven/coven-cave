"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/lib/icon";

export type EmptyStateProps = {
  icon?: IconName;
  headline: ReactNode;
  subtitle?: ReactNode;
  /** Primary action button(s). Use <Button>. */
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
  /** Set false when a manual live-region announcement already owns the update. */
  live?: boolean;
};

export function EmptyState({
  icon,
  headline,
  subtitle,
  actions,
  compact,
  className,
  live = true,
}: EmptyStateProps) {
  const classes = ["ui-empty-state", compact ? "ui-empty-state--compact" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} role={live ? "status" : undefined}>
      {icon ? (
        <div className="ui-empty-state-icon" aria-hidden>
          <Icon name={icon} width={20} />
        </div>
      ) : null}
      <div className="ui-empty-state-headline">{headline}</div>
      {subtitle ? <div className="ui-empty-state-subtitle">{subtitle}</div> : null}
      {actions ? <div className="ui-empty-state-actions">{actions}</div> : null}
    </div>
  );
}
