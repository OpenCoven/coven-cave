"use client";

import { useMemo, type CSSProperties } from "react";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { FamiliarSwitcher } from "@/components/familiar-switcher";
import { computePresence, REMOTE_HARNESSES } from "@/lib/presence";
import { computeQuickSwitch, QUICK_SWITCH_MAX } from "@/lib/familiar-quick-switch";
import { useFamiliarLastUsed, useFamiliarPins } from "@/lib/use-familiar-quick-switch";
import { useFamiliarSwitcherStyle } from "@/lib/familiar-switcher-style";
import { useFamiliarStripScope } from "@/lib/familiar-strip-scope";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";

type Props = {
  familiars: ResolvedFamiliar[];
  activeFamiliarId?: string | null;
  /** The full multiselect scope (empty/undefined = All). When ≥2 are selected
   *  every member is highlighted; falls back to `activeFamiliarId` otherwise. */
  selectedFamiliarIds?: ReadonlySet<string>;
  sessions: SessionRow[];
  responseNeeded?: Set<string>;
  /** `null` scopes to "All familiars". `opts.multi` (⌘/Ctrl-click) toggles the
   *  id in the multiselect set instead of replacing the scope. */
  onSelectFamiliar: (id: string | null, opts?: { multi?: boolean }) => void;
  /** Menu placement of the embedded full switcher. */
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
  /** Labels the embedded switcher's trigger with the active familiar name. */
  labeled?: boolean;
  /** How many avatars to show in the strip (default {@link QUICK_SWITCH_MAX}). */
  max?: number;
};

/**
 * The top-bar familiar control: a strip of one-tap avatars for the user's
 * pinned + most-recently-used familiars. If the user has selected dropdown
 * style or the strip cannot render, it falls back to the full {@link FamiliarSwitcher}.
 *
 * Pinned familiars lead the strip; the rest fill by recency (`computeQuickSwitch`).
 * Pinning itself is done from the switcher menu rows.
 */
export function FamiliarQuickSwitch({
  familiars,
  activeFamiliarId,
  selectedFamiliarIds,
  sessions,
  responseNeeded,
  onSelectFamiliar,
  placement = "bottom-start",
  labeled = false,
  max = QUICK_SWITCH_MAX,
}: Props) {
  const pins = useFamiliarPins();
  const lastUsed = useFamiliarLastUsed();
  const switcherStyle = useFamiliarSwitcherStyle();
  const stripScope = useFamiliarStripScope();
  const pinnedSet = useMemo(() => new Set(pins), [pins]);

  const quick = useMemo(
    () => computeQuickSwitch(familiars, { pins, lastUsed, activeId: activeFamiliarId, max, scope: stripScope }),
    [familiars, pins, lastUsed, activeFamiliarId, max, stripScope],
  );

  // "dropdown" preference hides the avatar strip, leaving only the switcher menu.
  const showStrip = switcherStyle === "avatars" && quick.length > 1;

  return (
    <div className="familiar-quickswitch">
      {showStrip ? (
        <ul className="familiar-quickswitch__strip" role="listbox" aria-label="Quick switch familiar">
          {quick.map((f) => {
            // Highlight every member of the multiselect scope; fall back to the
            // single active id when no scope set was supplied.
            const isActive = selectedFamiliarIds
              ? selectedFamiliarIds.has(f.id)
              : f.id === activeFamiliarId;
            const needsReply = responseNeeded?.has(f.id) ?? false;
            const presence = computePresence({
              familiar: f,
              sessions,
              needsReply,
              isRemoteHarness: f.harness ? REMOTE_HARNESSES.has(f.harness) : false,
            });
            const isPinned = pinnedSet.has(f.id);
            return (
              <li key={f.id} className="familiar-quickswitch__item">
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`familiar-quickswitch__btn focus-ring${isActive ? " is-active" : ""}`}
                  style={{ ["--familiar-accent" as string]: f.color } as CSSProperties}
                  // ⌘/Ctrl-click toggles this familiar in the scope (multiselect);
                  // a plain click selects only it.
                  onClick={(e) => onSelectFamiliar(f.id, { multi: e.metaKey || e.ctrlKey })}
                  title={`${f.display_name}${isPinned ? " · pinned" : ""} · ${presence.label} · ⌘-click to multi-select`}
                  aria-label={`Switch to ${f.display_name}${isPinned ? " (pinned)" : ""}`}
                >
                  <span className="familiar-quickswitch__avatar">
                    <FamiliarAvatar familiar={f} size="sm" />
                  </span>
                  <span className={`familiar-quickswitch__presence ${presence.dot}`} aria-hidden />
                  {isPinned ? <span className="familiar-quickswitch__pin" aria-hidden /> : null}
                  {needsReply ? <span className="familiar-quickswitch__unread" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {!showStrip ? (
        <FamiliarSwitcher
          familiars={familiars}
          activeFamiliarId={activeFamiliarId}
          sessions={sessions}
          responseNeeded={responseNeeded}
          onSelectFamiliar={onSelectFamiliar}
          placement={placement}
          labeled={labeled}
        />
      ) : null}
    </div>
  );
}
