"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/lib/icon";

export type ErrorStateProps = {
  /** Icon name. Defaults to `ph:warning` if omitted. */
  icon?: IconName;
  headline: ReactNode;
  subtitle?: ReactNode;
  /** Retry / fallback action button(s). Use <Button>. */
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
};

export function ErrorState({
  icon = "ph:warning",
  headline,
  subtitle,
  actions,
  compact,
  className,
}: ErrorStateProps) {
  const classes = ["ui-error-state", compact ? "ui-error-state--compact" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} role="alert">
      <div className="ui-error-state-icon" aria-hidden>
        <Icon name={icon} width={20} />
      </div>
      <div className="ui-error-state-headline">{headline}</div>
      {subtitle ? <div className="ui-error-state-subtitle">{subtitle}</div> : null}
      {actions ? <div className="ui-error-state-actions">{actions}</div> : null}
    </div>
  );
}
