"use client";

import { cloneElement, isValidElement, useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Tabs } from "@/components/ui/tabs";
import {
  CODE_PRESET_EVENT,
  type CodePreset,
} from "@/lib/code-layout-preset";

type Props = {
  /** Familiar conversation pane. */
  chat: ReactNode;
  /** Code pane: the comux surface — file tree + editable preview + terminal +
   *  project search + the working-tree changes review. */
  comux: ReactNode;
};

/**
 * Unified Code workspace (mode "code"): a single tabbed surface with three
 * tabs — Chat · Files · Changes. Instead of a side-by-side split, one tab fills
 * the surface at a time (Codex-style). All three panes stay mounted (hidden, not
 * unmounted) so the conversation, terminals, file preview, and diff review keep
 * their state across tab switches.
 *
 * The Files and Changes tabs are two faces of the same ComuxView instance: it is
 * rendered once and told which sub-view to show via the controlled `rightView`
 * prop, so switching Files↔Changes never remounts the terminals or preview.
 */
type CodeTab = "chat" | "files" | "changes";

export function CodeView({ chat, comux }: Props) {
  // Default to Files: choosing "Code" over "Chat" is a request to see code, and
  // the conversation is one tab away. Edits auto-surface the Changes tab.
  const [tab, setTab] = useState<CodeTab>("files");

  // Files and Changes are the same comux surface in two states. Render it once
  // and drive its right pane from the active tab; comux routes its own
  // diff-first auto-switch / file-open events back through onRightViewChange so
  // an agent edit (or a file click in chat) lands us on the right tab.
  const onRightViewChange = useCallback((next: "files" | "changes") => setTab(next), []);
  const comuxNode = isValidElement(comux)
    ? cloneElement(comux as ReactElement<Record<string, unknown>>, {
        rightView: tab === "changes" ? "changes" : "files",
        onRightViewChange,
      })
    : comux;

  // The Chat/Split/Review preset chips (CodeInlineToolbar, on the chat tab row)
  // map onto the tabs: Chat → Chat, Split → Files, Review → Changes. comux also
  // nudges Files/Changes via onRightViewChange, so this only has to own the Chat
  // case — but mapping all three keeps the behaviour explicit and self-contained.
  useEffect(() => {
    const onPreset = (e: Event) => {
      const preset = (e as CustomEvent<{ preset?: CodePreset }>).detail?.preset;
      if (!preset) return;
      setTab(preset === "chat" ? "chat" : preset === "review" ? "changes" : "files");
    };
    window.addEventListener(CODE_PRESET_EVENT, onPreset as EventListener);
    return () => window.removeEventListener(CODE_PRESET_EVENT, onPreset as EventListener);
  }, []);

  return (
    <div className="cave-code-page cave-code-page--tabbed flex min-h-0 min-w-0 flex-1 flex-col" data-code-layout="codex">
      <div className="cave-code-page__tabs flex shrink-0 items-center justify-center gap-1 border-b border-[var(--border-hairline)] p-1.5">
        <Tabs
          variant="segment"
          size="sm"
          ariaLabel="Code view"
          value={tab}
          onChange={(id) => setTab(id as CodeTab)}
          items={[
            { id: "chat", label: "Chat", icon: "ph:chats" },
            { id: "files", label: "Files", icon: "ph:file-code" },
            { id: "changes", label: "Changes", icon: "ph:git-diff" },
          ]}
        />
      </div>
      {/* Inactive panes are hidden (not unmounted) so terminals/chat/preview keep
          their state across tab taps. */}
      <div className={`cave-code-page__pane cave-code-page__pane--chat min-h-0 flex-1 flex-col ${tab === "chat" ? "flex" : "hidden"}`}>{chat}</div>
      <div className={`cave-code-page__pane cave-code-page__pane--workspace min-h-0 flex-1 flex-col ${tab !== "chat" ? "flex" : "hidden"}`}>{comuxNode}</div>
    </div>
  );
}
