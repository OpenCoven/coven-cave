"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import type { ChatModelState, ModelApplicationState, ModelScope } from "@/lib/chat-model-state";

type Props = {
  state: ChatModelState | null;
};

const SOURCE_LABELS: Record<ModelScope, string> = {
  "global-default": "Global default",
  "familiar-default": "Familiar default",
  session: "Session override",
  "next-message": "Next message",
};

const STATE_LABELS: Record<ModelApplicationState, string> = {
  unknown: "Application not confirmed",
  saved: "Saved in Cave",
  pending: "Runtime pending",
  applied: "Runtime confirmed",
  unsupported: "Runtime not confirmed",
  failed: "Runtime failed",
};

export function ChatModelControl({ state }: Props) {
  const [open, setOpen] = useState(false);
  if (!state) return null;

  const sourceLabel = SOURCE_LABELS[state.source];
  const stateLabel = STATE_LABELS[state.applicationState];
  const note = state.reason ?? "Runtime application is not confirmed.";

  return (
    <div
      className="cave-chat-model-wrap"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="cave-chat-model-control focus-ring"
        aria-label="Chat model"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title={`${state.effectiveModel} · ${sourceLabel} · ${stateLabel}`}
      >
        <Icon name="ph:brain-bold" width={12} aria-hidden />
        <span className="cave-chat-model-control__model">{state.effectiveModel}</span>
        <span className="cave-chat-model-control__state">{stateLabel}</span>
      </button>
      {open ? (
        <div className="cave-chat-model-popover" role="dialog" aria-label="Chat model details">
          <div className="cave-chat-model-popover__row">
            <span>Harness</span>
            <strong>{state.harness}</strong>
          </div>
          <div className="cave-chat-model-popover__row">
            <span>Model</span>
            <strong>{state.effectiveModel}</strong>
          </div>
          <div className="cave-chat-model-popover__row">
            <span>Source</span>
            <strong>{sourceLabel}</strong>
          </div>
          <div className="cave-chat-model-popover__row">
            <span>Status</span>
            <strong>{stateLabel}</strong>
          </div>
          <p>{note}</p>
        </div>
      ) : null}
    </div>
  );
}
