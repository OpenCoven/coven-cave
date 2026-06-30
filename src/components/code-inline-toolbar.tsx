"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  CODE_PRESETS,
  CODE_PRESET_EVENT,
  CODE_PRESET_HINTS,
  CODE_PRESET_ICONS,
  CODE_PRESET_LABELS,
  readCodePreset,
  writeCodePreset,
  type CodePreset,
} from "@/lib/code-layout-preset";

/** Persist + broadcast a preset pick. Comux listens for CODE_PRESET_EVENT and
 *  applies both the right-pane target and the Code/Changes column weighting. */
function applyPreset(next: CodePreset) {
  writeCodePreset(next);
  window.dispatchEvent(new CustomEvent(CODE_PRESET_EVENT, { detail: { preset: next } }));
}

/**
 * Code workspace view toggle — Code / Changes — hoisted onto the
 * Sessions/Memory tab row so the Code surface no longer needs a separate
 * toolbar row above the split.
 */
export function CodeInlineToolbar() {
  const [preset, setPreset] = useState<CodePreset>(() => readCodePreset());

  useEffect(() => {
    const onPreset = (e: Event) => {
      const p = (e as CustomEvent<{ preset?: CodePreset }>).detail?.preset;
      if (p) setPreset(p);
    };
    window.addEventListener(CODE_PRESET_EVENT, onPreset as EventListener);
    return () => {
      window.removeEventListener(CODE_PRESET_EVENT, onPreset as EventListener);
    };
  }, []);

  return (
    <div className="code-mode-toggle" role="group" aria-label="Code workspace view">
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
          title={`${CODE_PRESET_LABELS[p]} - ${CODE_PRESET_HINTS[p]}`}
          className="code-mode-toggle__button focus-ring"
        >
          <Icon name={CODE_PRESET_ICONS[p]} width={15} />
        </button>
      ))}
    </div>
  );
}
