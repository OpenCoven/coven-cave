"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import { AiToggle } from "./ai-toggle";

type DockChatProps = {
  /** Optional handler when user submits a prompt. */
  onSubmit?: (text: string, mode: "manual" | "agent") => void;
};

/**
 * Floating dock chat — bottom-right widget that persists across routes.
 * Lives in the layout so the same instance survives route changes.
 *
 * Three states: collapsed (header bar only), open (440px panel),
 * expanded (full-viewport overlay).
 */
export function DockChat({ onSubmit }: DockChatProps) {
  const [state, setState] = useState<"collapsed" | "open" | "expanded">("collapsed");
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"manual" | "agent">("agent");

  const submit = () => {
    if (!text.trim()) return;
    onSubmit?.(text, mode);
    setText("");
  };

  if (state === "collapsed") {
    return (
      <div className="ui-dock-chat ui-dock-chat--collapsed">
        <div className="ui-dock-chat-header">
          <button
            type="button"
            className="ui-dock-chat-title"
            onClick={() => setState("open")}
            style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, font: "inherit" }}
          >
            <Icon name="ph:plus" width={12} />
            <span>New chat</span>
            <Icon name="ph:caret-down" width={10} />
          </button>
          <div className="ui-dock-chat-actions">
            <button
              type="button"
              className="ui-dock-chat-icon-btn"
              onClick={() => setState("expanded")}
              aria-label="Expand chat"
              title="Expand"
            >
              <Icon name="ph:arrows-out-simple" width={14} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`ui-dock-chat${state === "expanded" ? " ui-dock-chat--expanded" : ""}`}>
      <div className="ui-dock-chat-header">
        <div className="ui-dock-chat-title">
          <Icon name="ph:plus" width={12} />
          <span>New chat</span>
          <Icon name="ph:caret-down" width={10} />
        </div>
        <div className="ui-dock-chat-actions">
          <AiToggle mode={mode} onChange={setMode} />
          <button
            type="button"
            className="ui-dock-chat-icon-btn"
            onClick={() => setState(state === "expanded" ? "open" : "expanded")}
            aria-label={state === "expanded" ? "Collapse" : "Expand"}
            title={state === "expanded" ? "Collapse" : "Expand"}
          >
            <Icon
              name={state === "expanded" ? "ph:arrows-in-simple" : "ph:arrows-out-simple"}
              width={14}
            />
          </button>
          <button
            type="button"
            className="ui-dock-chat-icon-btn"
            onClick={() => setState("collapsed")}
            aria-label="Minimize"
            title="Minimize"
          >
            <Icon name="ph:minus" width={14} />
          </button>
        </div>
      </div>

      <div className="ui-dock-chat-body">
        <div className="ui-dock-chat-body-title">Chat with your agents</div>
        <div>
          They know your workspace — issues, projects, skills.
        </div>
        <div>Ask for a summary, plan your day, or hand off a quick task.</div>
      </div>

      <div className="ui-dock-chat-input-row">
        <button
          type="button"
          className="ui-dock-chat-icon-btn"
          aria-label="Attach image"
          title="Attach image (not wired in v1)"
        >
          <Icon name="ph:camera" width={14} />
        </button>
        <input
          className="ui-dock-chat-input"
          placeholder="Tell me what to do..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
        <button
          type="button"
          className="ui-dock-chat-icon-btn"
          onClick={submit}
          aria-label="Send"
          title="Send (⌘↵)"
        >
          <Icon name="ph:arrow-up" width={14} />
        </button>
      </div>
    </div>
  );
}
