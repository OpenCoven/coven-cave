"use client";

import "@/styles/cave-composer.css";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import {
  ComposerContextActionRows,
  ComposerContextPickers,
  useComposerContextActions,
  type ComposerContextProps,
  type ComposerContextView,
} from "@/components/composer-context-pill";
import {
  ComposerLinkedWorkActions as LinkedWorkActions,
  type ComposerLinkedWorkActionsProps,
} from "@/components/composer-linked-work-actions";
import {
  ComposerResponseSections as ResponseSections,
  useComposerResponseHosts,
  type ComposerOptionSection,
} from "@/components/composer-options-menu";
import { ConnectHostDialog } from "@/components/composer-host-chip";
import {
  Popover,
  PopoverBody,
  PopoverItem,
  PopoverLabel,
  PopoverSeparator,
  usePopoverInitialFocus,
} from "@/components/ui/popover";
import { Icon } from "@/lib/icon";
import { ENHANCE_INTENTS, type EnhanceIntent } from "@/lib/prompt-enhancer";

export function ComposerLinkedWorkActions(props: ComposerLinkedWorkActionsProps) {
  return <LinkedWorkActions {...props} />;
}

export function ComposerResponseSections(props: ComponentProps<typeof ResponseSections>) {
  return <ResponseSections {...props} />;
}

export type ComposerImproveActions = {
  dictation?: {
    listening: boolean;
    toggle: () => void;
    disabled?: boolean;
  };
  promptSnippets: {
    onSelect: () => void;
    disabled?: boolean;
  };
  enhance: {
    onEnhance: (intent: EnhanceIntent) => void;
    disabled?: boolean;
    loading?: boolean;
  };
};

export type ComposerResponseActions = {
  hostValue: string;
  onHostPick: (id: string) => void;
  sections: ComposerOptionSection[];
  onSaveAsTemplate: () => void;
  saveAsTemplateDisabled?: boolean;
  indicator?: boolean;
};

export type ComposerActionsMenuProps = {
  context: ComposerContextProps;
  linkedWork: ComposerLinkedWorkActionsProps;
  improve: ComposerImproveActions;
  response: ComposerResponseActions;
  disabled?: boolean;
};

export function ComposerActionsMenu({
  context: contextProps,
  linkedWork,
  improve,
  response,
  disabled,
}: ComposerActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [contextView, setContextView] = useState<ComposerContextView>(null);
  const [enhanceView, setEnhanceView] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const hostRefreshPending = useRef(false);
  const hostsLoaded = useRef(false);
  const context = useComposerContextActions(contextProps);
  const { hostOptions, load, removeHost } = useComposerResponseHosts(response.hostValue);
  usePopoverInitialFocus(open, ".composer-actions__panel");

  useEffect(() => {
    if (!open) return;
    const force = hostRefreshPending.current;
    if (hostsLoaded.current && !force) return;
    hostRefreshPending.current = false;
    if (force) hostsLoaded.current = false;
    let cancelled = false;
    void load(force).then((loaded) => {
      if (!cancelled && loaded) hostsLoaded.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [load, open]);

  const closePanel = () => {
    setOpen(false);
    setEnhanceView(false);
  };
  const closeAll = () => {
    closePanel();
    setContextView(null);
  };
  const openContextPicker = (view: Exclude<ComposerContextView, null>) => {
    closePanel();
    setContextView(view);
  };

  const linkedContext = linkedWork.linkedContext;
  const hasLinkedContext = Boolean(
    linkedContext?.task ||
      linkedContext?.tasks?.length ||
      linkedContext?.github?.length,
  );
  const showIndicator = hasLinkedContext || Boolean(response.indicator);
  const expanded = open || contextView !== null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="cave-composer-plus composer-actions__trigger focus-ring"
        disabled={disabled}
        aria-label="Chat options"
        aria-haspopup="dialog"
        aria-expanded={expanded}
        title={`Chat options · ${context.summary}`}
        onClick={() => {
          if (expanded) {
            closeAll();
            return;
          }
          setEnhanceView(false);
          setOpen(true);
        }}
      >
        <Icon name="ph:plus" width={15} aria-hidden />
        {showIndicator ? <span className="composer-actions__indicator" aria-hidden /> : null}
      </button>

      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setOpen(true);
          else closePanel();
        }}
        anchorRef={triggerRef}
        placement="top-start"
        minWidth={320}
        ariaLabel="Chat options"
        className="composer-actions__panel"
      >
        <PopoverBody ariaLabel="Chat options" className="composer-actions__body">
          {enhanceView ? (
            <div className="composer-actions__enhance">
              <PopoverItem semantic="button" icon="ph:caret-left" onSelect={() => setEnhanceView(false)}>
                Enhance options
              </PopoverItem>
              <PopoverSeparator />
              {ENHANCE_INTENTS.map((intent) => (
                <PopoverItem
                  semantic="button"
                  key={intent.id}
                  icon="ph:sparkle"
                  disabled={improve.enhance.disabled && !improve.enhance.loading}
                  onSelect={() => {
                    closePanel();
                    improve.enhance.onEnhance(intent.id);
                  }}
                >
                  {intent.label}
                </PopoverItem>
              ))}
            </div>
          ) : (
            <>
              <section
                className="composer-actions__section composer-actions__context"
                role="group"
                aria-labelledby="composer-actions-context-label"
              >
                <PopoverLabel id="composer-actions-context-label">Context</PopoverLabel>
                <ComposerContextActionRows
                  context={context}
                  onOpenProject={() => openContextPicker("project")}
                  onOpenModel={() => openContextPicker("model")}
                  onOpenBranch={() => openContextPicker("branch")}
                  onClose={closePanel}
                  itemSemantic="button"
                />
              </section>

              <section
                className="composer-actions__section composer-actions__linked"
                role="group"
                aria-labelledby="composer-actions-linked-work-label"
              >
                <PopoverLabel id="composer-actions-linked-work-label">Linked Work</PopoverLabel>
                <ComposerLinkedWorkActions
                  {...linkedWork}
                  embedded
                  itemSemantic="button"
                  onCloseMenu={() => {
                    closePanel();
                    linkedWork.onCloseMenu?.();
                  }}
                />
              </section>

              <section
                className="composer-actions__section composer-actions__improve"
                role="group"
                aria-labelledby="composer-actions-improve-label"
              >
                <PopoverLabel id="composer-actions-improve-label">Improve</PopoverLabel>
                {improve.dictation ? (
                  <button
                    type="button"
                    className="ui-popover-item composer-actions__item"
                    aria-pressed={improve.dictation.listening}
                    disabled={improve.dictation.disabled}
                    onClick={() => {
                      closePanel();
                      improve.dictation?.toggle();
                    }}
                  >
                    <Icon
                      name="ph:microphone"
                      width={13}
                      aria-hidden
                      className={improve.dictation.listening ? "composer-actions__icon--live" : undefined}
                    />
                    <span>{improve.dictation.listening ? "Stop dictation" : "Voice message"}</span>
                  </button>
                ) : null}
                <PopoverItem
                  semantic="button"
                  icon="ph:chat-centered-text"
                  disabled={improve.promptSnippets.disabled}
                  onSelect={() => {
                    closePanel();
                    improve.promptSnippets.onSelect();
                  }}
                >
                  Prompt snippets
                </PopoverItem>
                <PopoverItem
                  semantic="button"
                  icon="ph:sparkle"
                  disabled={improve.enhance.disabled && !improve.enhance.loading}
                  onSelect={() => {
                    closePanel();
                    improve.enhance.onEnhance("auto");
                  }}
                >
                  {improve.enhance.loading ? "Enhancing…" : "Smart enhance"}
                </PopoverItem>
                <PopoverItem
                  semantic="button"
                  icon="ph:caret-right"
                  disabled={improve.enhance.disabled && !improve.enhance.loading}
                  onSelect={() => setEnhanceView(true)}
                >
                  Enhance options…
                </PopoverItem>
              </section>

              <section
                className="composer-actions__section composer-actions__response"
                role="group"
                aria-labelledby="composer-actions-response-label"
              >
                <PopoverLabel id="composer-actions-response-label">Response</PopoverLabel>
                <ComposerResponseSections
                  hostValue={response.hostValue}
                  hostOptions={hostOptions}
                  onHostPick={response.onHostPick}
                  onRemoveHost={(host) => void removeHost(host)}
                  sections={response.sections}
                  onConnectNew={() => {
                    closePanel();
                    setConnectOpen(true);
                  }}
                  onSaveAsTemplate={() => {
                    closePanel();
                    response.onSaveAsTemplate();
                  }}
                  saveAsTemplateDisabled={response.saveAsTemplateDisabled}
                />
              </section>
            </>
          )}
        </PopoverBody>
      </Popover>

      <ComposerContextPickers
        view={contextView}
        onViewChange={(view) => {
          setContextView(view);
          if (view) closePanel();
        }}
        anchorRef={triggerRef}
        context={context}
      />

      {connectOpen && (
        <ConnectHostDialog
          onClose={() => setConnectOpen(false)}
          onConnected={(host) => {
            response.onHostPick(host);
            hostRefreshPending.current = true;
          }}
        />
      )}
    </>
  );
}
