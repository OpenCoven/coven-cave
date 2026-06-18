"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import type { ChatModelState, ModelApplicationState, ModelScope } from "@/lib/chat-model-state";
import { catalogForRuntime } from "@/lib/runtime-models";

type Props = {
  state: ChatModelState | null;
  /**
   * Persist a model choice through the existing channels (session scope when a
   * chat exists, else familiar-default). Omit to render read-only.
   */
  onSelectModel?: (modelId: string) => void;
  busy?: boolean;
  /**
   * "pill" renders the trigger as a dropdown pill matching the familiar
   * selector (glyph + model + caret-up-down) so model selection reads as the
   * same control type as picking a familiar. Default keeps the compact in-chat
   * chip with its inline application-state label.
   */
  variant?: "default" | "pill";
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

export function ChatModelControl({ state, onSelectModel, busy, variant = "default" }: Props) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    if (!open) setCustom("");
  }, [open]);

  if (!state) return null;

  const sourceLabel = SOURCE_LABELS[state.source];
  const stateLabel = STATE_LABELS[state.applicationState];
  const note = state.reason ?? "Runtime application is not confirmed.";

  const catalog = catalogForRuntime(state.harness);
  const canPick = typeof onSelectModel === "function";
  const options = catalog?.models ?? [];
  const allowCustom = catalog?.allowCustom ?? true;

  const choose = (modelId: string) => {
    const trimmed = modelId.trim();
    if (!trimmed || !onSelectModel || busy) return;
    onSelectModel(trimmed);
    setOpen(false);
  };

  return (
    <div
      className="cave-chat-model-wrap"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className={`cave-chat-model-control focus-ring${variant === "pill" ? " cave-chat-model-control--pill" : ""}`}
        aria-label="Chat model"
        aria-expanded={open}
        aria-haspopup={canPick ? "menu" : undefined}
        onClick={() => setOpen((value) => !value)}
        title={`${state.effectiveModel} · ${sourceLabel} · ${stateLabel}`}
      >
        <Icon name="ph:brain-bold" width={12} aria-hidden />
        <span className="cave-chat-model-control__model">{state.effectiveModel}</span>
        {variant === "pill" ? (
          <Icon name="ph:caret-up-down-bold" width={10} className="cave-chat-model-control__caret" aria-hidden />
        ) : (
          <span className="cave-chat-model-control__state">{stateLabel}</span>
        )}
      </button>
      {open ? (
        <div
          className="cave-chat-model-popover"
          role={canPick ? "menu" : "dialog"}
          aria-label="Chat model"
        >
          {canPick ? (
            <div className="cave-chat-model-popover__picker">
              <p className="cave-chat-model-popover__heading">
                Model for {state.harness} runtime
              </p>
              {options.length > 0 ? (
                <ul className="cave-chat-model-popover__options">
                  {options.map((option) => {
                    const active = option.id === state.effectiveModel;
                    return (
                      <li key={option.id}>
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={active}
                          className="cave-chat-model-popover__option focus-ring"
                          disabled={busy}
                          onClick={() => choose(option.id)}
                        >
                          <span>{option.label}</span>
                          <span className="cave-chat-model-popover__option-id">{option.id}</span>
                          {active ? <Icon name="ph:check-bold" width={12} aria-hidden /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {allowCustom ? (
                <form
                  className="cave-chat-model-popover__custom"
                  onSubmit={(event) => {
                    event.preventDefault();
                    choose(custom);
                  }}
                >
                  <label className="cave-chat-model-popover__custom-label" htmlFor="cave-chat-model-custom">
                    {options.length > 0 ? "Custom model" : "Model id"}
                  </label>
                  <div className="cave-chat-model-popover__custom-row">
                    <input
                      id="cave-chat-model-custom"
                      type="text"
                      className="cave-chat-model-popover__custom-input"
                      value={custom}
                      onChange={(event) => setCustom(event.target.value)}
                      placeholder="provider/model"
                      disabled={busy}
                    />
                    <button
                      type="submit"
                      className="cave-chat-model-popover__custom-apply focus-ring"
                      disabled={busy || !custom.trim()}
                    >
                      Use
                    </button>
                  </div>
                </form>
              ) : null}
              <hr className="cave-chat-model-popover__divider" />
            </div>
          ) : null}
          <div className="cave-chat-model-popover__row">
            <span>Runtime</span>
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
