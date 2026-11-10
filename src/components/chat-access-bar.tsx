"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import type { AccessFixAction, ChatBuildAccess, ChatGrantUndo } from "@/lib/chat-access-escape";

/**
 * In-place access controls for one chat (#6445).
 *
 * `ChatAccessBar` sits above the composer while the chat is in Explore (or
 * just after a grant made here, to offer Undo). `AccessFixActions` is the
 * error strip's fix row for access refusals. Every action is a deliberate
 * press; granting asks for confirmation first and names exactly what changes.
 */

type GrantConfirmProps = {
  familiarName: string;
  projectName: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

function GrantConfirm({ familiarName, projectName, busy, onConfirm, onCancel }: GrantConfirmProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Confirm write access"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || busy) return;
        event.stopPropagation();
        onCancel();
      }}
    >
      <span className="min-w-0 flex-1 basis-60 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
        {familiarName} will be able to change files in {projectName}. You can undo this.
      </span>
      <Button size="sm" variant="primary" leadingIcon="ph:check-bold" loading={busy} disabled={busy} onClick={onConfirm} autoFocus>
        Confirm write access
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

export function ChatAccessBar({
  mode,
  familiarName,
  projectName,
  projectAccess,
  buildAccess,
  planReady,
  busy,
  accessBusy,
  grantUndo,
  onSwitchToBuild,
  onBuildPlan,
  onGrantWrite,
  onUndoGrant,
  onDismissUndo,
}: {
  mode: "read" | "full";
  familiarName: string;
  projectName: string | null;
  projectAccess: "read" | "write" | null;
  buildAccess: ChatBuildAccess | null;
  planReady: boolean;
  /** A turn or an access change is running: Build actions wait. */
  busy: boolean;
  /** An access change is running: Undo and Confirm wait (a running turn doesn't block Undo). */
  accessBusy: boolean;
  grantUndo: ChatGrantUndo | null;
  onSwitchToBuild: () => void;
  onBuildPlan: () => void;
  /** Present when a registered project can name the grant. */
  onGrantWrite?: () => void;
  onUndoGrant: () => void;
  onDismissUndo: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const explore = mode === "read";
  const undoRef = useRef<HTMLButtonElement>(null);
  const grantTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!explore) setConfirming(false);
  }, [explore]);
  // A confirmed grant unmounts the button that had focus. Hand focus to Undo,
  // the next useful control, but only when focus was actually lost.
  useEffect(() => {
    if (!grantUndo || typeof document === "undefined") return;
    const active = document.activeElement;
    if (!active || active === document.body) undoRef.current?.focus();
  }, [grantUndo]);
  if (!explore && !grantUndo) return null;

  const buildBlocked = buildAccess?.available === false ? buildAccess.message : null;
  const projectReadOnly = projectAccess === "read" && projectName !== null;

  let body: string;
  if (!explore && grantUndo) {
    body = `${grantUndo.familiarName} can now change files in ${grantUndo.projectName}.`;
  } else if (buildBlocked) {
    body = `Build isn't available here: ${buildBlocked}`;
  } else if (projectReadOnly) {
    body = `${projectName} is read only for ${familiarName}. Give ${familiarName} write access to use Build here.`;
  } else if (planReady) {
    body = `${familiarName} has a plan ready. Build it to let ${familiarName} make the changes.`;
  } else {
    body = `${familiarName} can read files but can't change them.`;
  }

  return (
    <section
      aria-label="Chat access"
      data-access-bar={explore ? "explore" : "granted"}
      className="cave-chat-access-bar mb-1.5 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2"
    >
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
        {explore ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/50 px-1.5 py-0.5 font-mono text-[length:var(--text-2xs)] text-[var(--text-secondary)]">
            <Icon name="ph:eye" width={11} aria-hidden />
            Explore · read only
          </span>
        ) : (
          <Icon name="ph:check-circle" width={13} aria-hidden className="shrink-0 text-[var(--accent-presence)]" />
        )}
        <span role="status" className="min-w-0 flex-1 basis-56 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
          {body}
        </span>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {explore && !buildBlocked && projectReadOnly && onGrantWrite ? (
            <Button
              ref={grantTriggerRef}
              size="sm"
              variant="secondary"
              leadingIcon="ph:key"
              aria-expanded={confirming}
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              Give write access…
            </Button>
          ) : null}
          {explore && !buildBlocked && !projectReadOnly && planReady ? (
            <Button size="sm" variant="primary" leadingIcon="ph:hammer" disabled={busy} onClick={onBuildPlan}>
              Build this plan
            </Button>
          ) : null}
          {explore && !buildBlocked && !projectReadOnly && !planReady ? (
            <Button size="sm" variant="secondary" leadingIcon="ph:hammer" disabled={busy} onClick={onSwitchToBuild}>
              Switch to Build
            </Button>
          ) : null}
          {!explore && grantUndo ? (
            <>
              <Button ref={undoRef} size="sm" variant="secondary" leadingIcon="ph:arrow-counter-clockwise" loading={accessBusy} disabled={accessBusy} onClick={onUndoGrant}>
                Undo write access
              </Button>
              <Button size="sm" variant="ghost" aria-label="Dismiss access change" disabled={accessBusy} onClick={onDismissUndo}>
                <Icon name="ph:x-bold" width={11} aria-hidden />
              </Button>
            </>
          ) : null}
        </div>
        {confirming && projectName && onGrantWrite ? (
          <div className="basis-full">
            <GrantConfirm
              familiarName={familiarName}
              projectName={projectName}
              busy={accessBusy}
              onConfirm={() => {
                setConfirming(false);
                onGrantWrite();
              }}
              onCancel={() => {
                setConfirming(false);
                grantTriggerRef.current?.focus();
              }}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** The error strip's fix row for an access refusal. */
export function AccessFixActions({
  actions,
  familiarName,
  projectName,
  busy,
  buttonClassName,
  primaryClassName,
  onGrantWriteAndRetry,
  onRetryExplore,
  onRetryBuild,
  onOpenProjectAccess,
}: {
  actions: AccessFixAction[];
  familiarName: string;
  projectName: string | null;
  busy: boolean;
  buttonClassName: string;
  primaryClassName: string;
  onGrantWriteAndRetry: () => void;
  onRetryExplore: () => void;
  onRetryBuild: () => void;
  onOpenProjectAccess: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const grantTriggerRef = useRef<HTMLButtonElement>(null);
  if (actions.length === 0) return null;
  const className = (index: number) => (index === 0 ? primaryClassName : buttonClassName);
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-5 pb-2 text-xs">
      {actions.map((action, index) => {
        switch (action) {
          case "grant-write-retry":
            return projectName ? (
              <button
                key={action}
                ref={grantTriggerRef}
                type="button"
                className={className(index)}
                aria-expanded={confirming}
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                <Icon name="ph:key" width={11} aria-hidden />
                {`Give ${familiarName} write access to ${projectName} and retry`}
              </button>
            ) : null;
          case "retry-explore":
            return (
              <button key={action} type="button" className={className(index)} disabled={busy} onClick={onRetryExplore}>
                <Icon name="ph:eye" width={11} aria-hidden />
                Use Explore and retry
              </button>
            );
          case "retry-build":
            return (
              <button key={action} type="button" className={className(index)} disabled={busy} onClick={onRetryBuild}>
                <Icon name="ph:hammer" width={11} aria-hidden />
                Use Build and retry
              </button>
            );
          case "open-project-access":
            return (
              <button key={action} type="button" className={className(index)} onClick={onOpenProjectAccess}>
                <Icon name="ph:folders-bold" width={11} aria-hidden />
                Review project access
              </button>
            );
          default:
            return null;
        }
      })}
      {confirming && projectName ? (
        <div className="basis-full">
          <GrantConfirm
            familiarName={familiarName}
            projectName={projectName}
            busy={busy}
            onConfirm={() => {
              setConfirming(false);
              onGrantWriteAndRetry();
            }}
            onCancel={() => {
              setConfirming(false);
              grantTriggerRef.current?.focus();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
