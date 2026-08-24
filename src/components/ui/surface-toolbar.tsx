"use client";

import type { ReactNode } from "react";
import type { IconName } from "@/lib/icon";
import {
  partitionSurfaceToolbarActions,
  type SurfaceToolbarActionBase,
} from "@/lib/surface-toolbar-actions";
import { Button } from "./button";
import { OverflowMenu } from "./overflow-menu";
import { PopoverItem } from "./popover";
import { ViewHeader } from "./view-header";

export type SurfaceToolbarAction = SurfaceToolbarActionBase & {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  title?: string;
};

export type SurfaceToolbarProps = {
  eyebrow?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  search?: ReactNode;
  filters?: ReactNode;
  actions?: readonly SurfaceToolbarAction[];
  overflowAriaLabel?: string;
  className?: string;
};

const NO_ACTIONS: readonly SurfaceToolbarAction[] = [];

export function SurfaceToolbar({
  eyebrow,
  title,
  subtitle,
  search,
  filters,
  actions = NO_ACTIONS,
  overflowAriaLabel = "More surface actions",
  className,
}: SurfaceToolbarProps) {
  const partitioned = partitionSurfaceToolbarActions(actions);
  const hasTitleContent = title != null || subtitle != null;
  const hasControls =
    filters != null ||
    partitioned.visible.length > 0 ||
    partitioned.overflow.length > 0;

  const titleNode = hasTitleContent ? (
    <span className="ui-surface-toolbar__title-stack">
      {title != null ? <span className="ui-surface-toolbar__title">{title}</span> : null}
      {subtitle != null ? (
        <span className="ui-surface-toolbar__subtitle">{subtitle}</span>
      ) : null}
    </span>
  ) : null;

  const controls = hasControls ? (
    <div className="ui-surface-toolbar__controls">
      {filters != null ? <div className="ui-surface-toolbar__filters">{filters}</div> : null}
      {partitioned.visible.length > 0 ? (
        <div className="ui-surface-toolbar__visible-actions">
          {partitioned.visible.map((action) => (
            <Button
              key={action.id}
              variant={action.placement === "primary" ? "primary" : "ghost"}
              size="sm"
              className="focus-ring"
              leadingIcon={action.icon}
              disabled={action.disabled}
              title={action.title}
              aria-label={action.label}
              aria-pressed={action.active}
              onClick={action.onSelect}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
      {partitioned.overflow.length > 0 ? (
        <OverflowMenu ariaLabel={overflowAriaLabel}>
          {partitioned.overflow.map((action) => (
            <PopoverItem
              key={action.id}
              icon={action.icon}
              disabled={action.disabled}
              title={action.title}
              onSelect={action.onSelect}
            >
              {action.label}
            </PopoverItem>
          ))}
        </OverflowMenu>
      ) : null}
    </div>
  ) : null;

  return (
    <ViewHeader
      title={titleNode}
      eyebrow={eyebrow}
      search={search}
      actions={controls}
      className={["ui-surface-toolbar", className ?? ""].filter(Boolean).join(" ")}
    />
  );
}
