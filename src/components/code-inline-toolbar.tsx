"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  CODE_PRESETS,
  CODE_PRESET_EVENT,
  CODE_PRESET_HIDES_PROJECT_LIST,
  CODE_PRESET_HINTS,
  CODE_PRESET_ICONS,
  CODE_PRESET_LABELS,
  CODE_PROJECT_LIST_EVENT,
  readCodePreset,
  writeCodePreset,
  writeProjectListCollapsed,
  type CodePreset,
} from "@/lib/code-layout-preset";

/** The inline toggle asks the Shell to show/hide the companion panel (the Shell
 *  owns the panel ref, so we go over an event rather than reaching into it). */
export const TOGGLE_RIGHT_PANEL_EVENT = "cave:toggle-right-panel";
/** The Shell broadcasts the companion (familiar) panel's open state so this
 *  toggle can mirror it. `detail.open: boolean`; the Shell also sets the
 *  matching `:root[data-familiar-open]` attribute for the initial read. */
export const FAMILIAR_OPEN_EVENT = "cave:familiar-open";

/** Persist + broadcast a preset pick. The chat-pane resize (code-view) and the
 *  comux right-pane (comux-view) both listen for CODE_PRESET_EVENT, so this
 *  toolbar never has to reach into either pane. */
function applyPreset(next: CodePreset) {
  writeCodePreset(next);
  const collapsed = CODE_PRESET_HIDES_PROJECT_LIST[next];
  writeProjectListCollapsed(collapsed);
  window.dispatchEvent(new CustomEvent(CODE_PROJECT_LIST_EVENT, { detail: { collapsed } }));
  window.dispatchEvent(new CustomEvent(CODE_PRESET_EVENT, { detail: { preset: next } }));
}

/**
 * Code workspace layout controls — Chat/Split/Review presets + the companion
 * panel toggle — hoisted onto the Sessions/Memory tab row so the Code surface
 * no longer needs a separate toolbar row above the split.
 */
export function CodeInlineToolbar() {
  const [preset, setPreset] = useState<CodePreset>(() => readCodePreset());
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    const onPreset = (e: Event) => {
      const p = (e as CustomEvent<{ preset?: CodePreset }>).detail?.preset;
      if (p) setPreset(p);
    };
    const onPanel = (e: Event) => {
      const open = (e as CustomEvent<{ open?: boolean }>).detail?.open;
      if (typeof open === "boolean") setPanelOpen(open);
    };
    window.addEventListener(CODE_PRESET_EVENT, onPreset as EventListener);
    window.addEventListener(FAMILIAR_OPEN_EVENT, onPanel as EventListener);
    setPanelOpen(document.documentElement.hasAttribute("data-familiar-open"));
    return () => {
      window.removeEventListener(CODE_PRESET_EVENT, onPreset as EventListener);
      window.removeEventListener(FAMILIAR_OPEN_EVENT, onPanel as EventListener);
    };
  }, []);

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <div className="flex items-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/40 p-0.5 text-[11px]">
        {CODE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setPreset(p);
              applyPreset(p);
            }}
            aria-pressed={preset === p}
            aria-label={CODE_PRESET_LABELS[p]}
            title={`${CODE_PRESET_LABELS[p]} — ${CODE_PRESET_HINTS[p]}`}
            className={`flex items-center justify-center rounded-[5px] px-1.5 py-1 transition-colors ${
              preset === p
                ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {/* Icon-only: the chat pane (esp. the Review preset) is too narrow
                for labels alongside the familiar scope + Sessions/Memory tabs.
                The active chip is highlighted; tooltips name each layout. */}
            <Icon name={CODE_PRESET_ICONS[p]} width={14} />
          </button>
        ))}
      </div>
      <button
        type="button"
        className="code-panel-toggle focus-ring"
        aria-label={panelOpen ? "Hide side panel" : "Show side panel"}
        aria-pressed={panelOpen}
        title={panelOpen ? "Hide side panel" : "Show side panel"}
        onClick={() => window.dispatchEvent(new CustomEvent(TOGGLE_RIGHT_PANEL_EVENT))}
      >
        <Icon name={panelOpen ? "ph:sidebar-simple-fill" : "ph:sidebar-simple"} width={14} />
      </button>
    </div>
  );
}
