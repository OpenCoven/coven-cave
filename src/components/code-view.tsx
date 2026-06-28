"use client";

import { cloneElement, isValidElement, useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Icon } from "@/lib/icon";
import {
  CODE_PRESET_EVENT,
  type CodePreset,
} from "@/lib/code-layout-preset";

type Props = {
  /** Familiar conversation pane. Holds the center column. */
  chat: ReactNode;
  /** Code pane: the comux surface — file tree + editable preview + terminal +
   *  project search + the working-tree changes review. Lives in the Environment rail. */
  comux: ReactNode;
};

/**
 * Unified Code workspace (mode "code"), styled after the OpenAI Codex layout: the
 * familiar conversation owns the center column, and a right-hand **Environment**
 * rail hosts the working tree — Changes (the git diff) and Files (tree + editable
 * preview + terminal). Both columns stay mounted side by side so the conversation,
 * terminals, preview, and diff review keep their state; the rail can be collapsed
 * to give the conversation the full width.
 *
 * Files and Changes are two faces of the same ComuxView instance: it is rendered
 * once inside the rail and told which sub-view to show via the controlled
 * `rightView` prop, so toggling Files↔Changes (or an agent edit auto-surfacing the
 * diff) never remounts the terminals or preview.
 */
type EnvView = "changes" | "files";

export function CodeView({ chat, comux }: Props) {
  // The Environment rail starts open on Changes: opening the Code surface is a
  // request to watch what the familiar is doing to the working tree. Collapse it
  // (via the rail's own control, or the Chat preset) to focus the conversation.
  const [envOpen, setEnvOpen] = useState(true);
  const [envView, setEnvView] = useState<EnvView>("changes");

  // The rail body is one comux surface in two states. Render it once and drive its
  // right pane from the active segment; comux routes its own diff-first auto-switch
  // / file-open events back through onRightViewChange so an agent edit (or a file
  // click in chat) opens the rail on the right view.
  const onRightViewChange = useCallback((next: EnvView) => {
    setEnvView(next);
    setEnvOpen(true);
  }, []);
  const comuxNode = isValidElement(comux)
    ? cloneElement(comux as ReactElement<Record<string, unknown>>, {
        rightView: envView,
        onRightViewChange,
      })
    : comux;

  // The Chat/Split/Review preset chips (CodeInlineToolbar, on the chat tab row)
  // map onto the Codex split: Chat collapses the rail (conversation only), Split
  // opens it on Files, Review opens it on Changes. comux also nudges Files/Changes
  // via onRightViewChange, so this owns the open/collapse intent.
  useEffect(() => {
    const onPreset = (e: Event) => {
      const preset = (e as CustomEvent<{ preset?: CodePreset }>).detail?.preset;
      if (!preset) return;
      if (preset === "chat") {
        setEnvOpen(false);
        return;
      }
      setEnvOpen(true);
      setEnvView(preset === "review" ? "changes" : "files");
    };
    window.addEventListener(CODE_PRESET_EVENT, onPreset as EventListener);
    return () => window.removeEventListener(CODE_PRESET_EVENT, onPreset as EventListener);
  }, []);

  return (
    <div
      className="cave-code-page cave-code-page--codex flex min-h-0 min-w-0 flex-1"
      data-code-layout="codex"
      data-env-open={envOpen ? "1" : "0"}
    >
      {/* Center column — the familiar conversation. */}
      <main className="cave-code-page__conversation flex min-h-0 min-w-0 flex-1 flex-col">{chat}</main>

      {/* Right Environment rail — the working tree (Changes / Files). Stays mounted
          even while collapsed so terminals/preview/diff keep their state; a thin
          rail button reopens it. */}
      {envOpen ? (
        <aside className="cave-code-page__env flex min-h-0 shrink-0 flex-col" aria-label="Environment">
          <header className="cave-code-page__env-head flex shrink-0 items-center gap-2">
            <Icon name="ph:cube" width={15} />
            <span className="cave-code-page__env-title">Environment</span>
            <div className="cave-code-page__env-seg ml-auto flex items-center" role="tablist" aria-label="Environment view">
              {(["changes", "files"] as EnvView[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={envView === v}
                  className="cave-code-page__env-tab"
                  data-active={envView === v ? "1" : "0"}
                  onClick={() => setEnvView(v)}
                >
                  <Icon name={v === "changes" ? "ph:git-diff" : "ph:file-code"} width={13} />
                  <span>{v === "changes" ? "Changes" : "Files"}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="cave-code-page__env-collapse focus-ring"
              aria-label="Hide Environment"
              title="Hide Environment"
              onClick={() => setEnvOpen(false)}
            >
              <Icon name="ph:sidebar-simple-fill" width={14} />
            </button>
          </header>
          <div className="cave-code-page__env-body flex min-h-0 flex-1 flex-col">{comuxNode}</div>
        </aside>
      ) : (
        <button
          type="button"
          className="cave-code-page__env-rail focus-ring"
          aria-label="Show Environment"
          title="Show Environment"
          onClick={() => setEnvOpen(true)}
        >
          <Icon name="ph:cube" width={16} />
          <span className="cave-code-page__env-rail-label">Environment</span>
        </button>
      )}
    </div>
  );
}
