"use client";

import "@/styles/cave-composer.css";

// ComposerActionsMenu — the chat composer's "+" menu, now the shared
// hierarchical ComposerAddMenu cascade (reference design): attach on top,
// then "Add to project ›", "Add from GitHub ›" (linked work), Skills ›,
// Connectors ›, the improve utilities, and a chat-specific footer (Model &
// tuning / Branch via the chained context pickers, Response options ›,
// Save as template). The old four stacked sections (Context / Linked Work /
// Improve / Response) fold into this one compact root menu.

import { useEffect, useRef, useState, type ComponentProps } from "react";
import {
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
  PopoverSeparator,
  PopoverSubmenu,
  usePopoverInitialFocus,
} from "@/components/ui/popover";
import { AddMenuRow, ComposerAddMenu } from "@/components/composer-add-menu";
import { Icon } from "@/lib/icon";
import { NO_PROJECT_ID } from "@/lib/chat-projects";
import type { SkillOption } from "@/lib/slash-skill";
import type { EnhanceIntent } from "@/lib/prompt-enhancer";

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
  /** "Add files or photos" — relocated from the standalone attach button. */
  attach: {
    onSelect: () => void;
    disabled?: boolean;
    hint?: string;
  };
  /** Skills flyout; picking inserts `/skill <id> ` into the composer. */
  skills?: { onPickSkill: (skill: SkillOption) => void };
  disabled?: boolean;
};

export function ComposerActionsMenu({
  context: contextProps,
  linkedWork,
  improve,
  response,
  attach,
  skills,
  disabled,
}: ComposerActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [contextView, setContextView] = useState<ComposerContextView>(null);
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

  const closePanel = () => setOpen(false);
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

  // The effective project selection (radio check in "Add to project ›"):
  // an explicit No-project choice maps to NO_PROJECT_ID, else the resolved
  // project (null value falls back to the first project, pill parity).
  const selectedProjectId =
    contextProps.projectValue === NO_PROJECT_ID
      ? NO_PROJECT_ID
      : context.selectedProject?.id ?? null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="cave-composer-plus composer-actions__trigger focus-ring"
        disabled={disabled}
        aria-label="Chat options"
        aria-haspopup="menu"
        aria-expanded={expanded}
        title={`Chat options · ${context.summary}`}
        onClick={() => {
          if (expanded) {
            closeAll();
            return;
          }
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
        minWidth={260}
        ariaLabel="Chat options"
        className="composer-actions__panel"
      >
        <PopoverBody role="menu" ariaLabel="Chat options" className="composer-actions__body">
          <ComposerAddMenu
            open={open}
            onClose={closePanel}
            attach={attach}
            projects={{
              projects: context.sortedProjects.map((p) => ({ id: p.id, name: p.name })),
              selectedId: selectedProjectId,
              onPick: contextProps.onProjectChange,
              noProjectId: contextProps.allowNoProject ? NO_PROJECT_ID : undefined,
              onStartNewProject: contextProps.createProject
                ? context.addFlow.beginAddProject
                : undefined,
            }}
            github={{
              submenu: (
                <LinkedWorkActions
                  {...linkedWork}
                  embedded
                  onCloseMenu={() => {
                    closePanel();
                    linkedWork.onCloseMenu?.();
                  }}
                />
              ),
            }}
            skills={skills}
            connectors
            legacy={{
              dictation: improve.dictation,
              promptSnippets: improve.promptSnippets,
              enhance: improve.enhance,
            }}
            footer={
              <>
                <PopoverSeparator />
                <AddMenuRow
                  icon="ph:sliders-horizontal"
                  label="Model & tuning…"
                  title={context.summary}
                  onSelect={() => openContextPicker("model")}
                />
                {context.hasGit ? (
                  <AddMenuRow
                    icon="ph:git-branch"
                    label="Branch…"
                    hint={context.branch ?? undefined}
                    onSelect={() => openContextPicker("branch")}
                  />
                ) : null}
                <PopoverSubmenu icon="ph:gear-six" label="Response options" minWidth={300}>
                  <ResponseSections
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
                </PopoverSubmenu>
              </>
            }
          />
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
