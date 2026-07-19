"use client";

import type { IconName } from "@/lib/icon";
import { ContextMenu, type ContextMenuState } from "@/components/ui/context-menu";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { PopoverItem } from "@/components/ui/popover";

export type WorkspaceSidebarAction = {
  id: string;
  label: string;
  icon: IconName;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

function SidebarActionItems({
  actions,
  onActionSelect,
}: {
  actions: WorkspaceSidebarAction[];
  onActionSelect?: (action: WorkspaceSidebarAction) => void;
}) {
  return actions.map((action) => (
    <PopoverItem
      key={action.id}
      icon={action.icon}
      danger={action.danger}
      disabled={action.disabled}
      onSelect={() => {
        if (onActionSelect) onActionSelect(action);
        else action.onSelect();
      }}
    >
      {action.label}
    </PopoverItem>
  ));
}

export function SidebarOverflowMenu({
  ariaLabel,
  actions,
}: {
  ariaLabel: string;
  actions: WorkspaceSidebarAction[];
}) {
  if (actions.length === 0) return null;
  return (
    <OverflowMenu ariaLabel={ariaLabel} className="cnav__overflow" placement="bottom-end">
      <SidebarActionItems actions={actions} />
    </OverflowMenu>
  );
}

export function SidebarContextMenu({
  state,
  onClose,
  ariaLabel,
  actions,
}: {
  state: ContextMenuState;
  onClose: () => void;
  ariaLabel: string;
  actions: WorkspaceSidebarAction[];
}) {
  return (
    <ContextMenu state={state} onClose={onClose} ariaLabel={ariaLabel}>
      <SidebarActionItems
        actions={actions}
        onActionSelect={(action) => {
          onClose();
          action.onSelect();
        }}
      />
    </ContextMenu>
  );
}
