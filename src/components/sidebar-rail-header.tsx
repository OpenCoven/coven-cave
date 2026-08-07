"use client";

/**
 * SidebarRailHeader — the siderail's shared top: familiar scope + New chat.
 *
 * Both rail sections render this. Home (`SidebarMinimal`) and Chat
 * (`WorkspaceSidebar`) are separate components with separate stylesheets, and
 * for a long time each re-declared this header's chrome by hand — the only
 * parity contract being a `/* Matches .cnav__new on the Chat rail *\/` comment
 * in one of them. The copies drifted (a hardcoded 10px radius against
 * `var(--radius-control)`, `--text-sm` against `--text-base`, 32px against
 * 34px), so toggling Home ↔ Chat visibly restyled controls that never move.
 *
 * The design gates could not catch it: every drifted value was token-legal, and
 * nothing checks that two components which must look identical picked the SAME
 * token. One component with one namespace is the fix — see
 * docs/specs/2026-08-06-sidebar-home-chat-parity-prompt.md.
 *
 * Presentational only: no data fetching, no mode knowledge. Section-specific
 * chrome (Chat's Organize menu, Home's brand mark) stays with its own sidebar.
 */

import type { ReactNode } from "react";
import { FamiliarSwitcher } from "@/components/familiar-switcher";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";

export type SidebarRailHeaderProps = {
  familiars: ResolvedFamiliar[];
  activeFamiliarId?: string | null;
  /** Multiselect scope (≥2 ids) — the trigger summarizes the count. */
  selectedFamiliarIds?: ReadonlySet<string>;
  sessions: SessionRow[];
  responseNeeded?: Set<string>;
  /** `null` scopes to "All familiars". */
  onSelectFamiliar: (id: string | null, opts?: { multi?: boolean }) => void;
  onNewChat: () => void;
  /** Native tooltip on the New-chat button — Chat names its ⌘N shortcut. */
  newChatTitle?: string;
  /** Trailing slot inside the New-chat button. Chat puts its ⌘N hint here
   *  rather than forking the button, which is how the two drifted before. */
  newChatTrailing?: ReactNode;
};

export function SidebarRailHeader({
  familiars,
  activeFamiliarId = null,
  selectedFamiliarIds,
  sessions,
  responseNeeded,
  onSelectFamiliar,
  onNewChat,
  newChatTitle = "New chat",
  newChatTrailing,
}: SidebarRailHeaderProps) {
  return (
    <div className="rail-header">
      <div className="rail-header__scope">
        <FamiliarSwitcher
          familiars={familiars}
          activeFamiliarId={activeFamiliarId}
          selectedFamiliarIds={selectedFamiliarIds}
          sessions={sessions}
          responseNeeded={responseNeeded}
          onSelectFamiliar={onSelectFamiliar}
          placement="bottom-start"
          labeled
        />
      </div>
      <div className="rail-header__actions">
        <button type="button" className="rail-header__new focus-ring" onClick={onNewChat} title={newChatTitle}>
          <Icon
            name="ph:note-pencil"
            className="rail-header__new-icon"
            width={CAVE_ICON_SIZE.sidePanelAction}
            height={CAVE_ICON_SIZE.sidePanelAction}
            aria-hidden
          />
          <span className="rail-header__new-label">New chat</span>
          {newChatTrailing}
        </button>
      </div>
    </div>
  );
}
