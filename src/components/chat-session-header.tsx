"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { CaveProject } from "@/lib/cave-projects";
import { chatProjectById } from "@/lib/chat-projects";
import { archiveAction, sessionMenuSections, voiceAction, type SessionMenuItemId } from "@/lib/chat-session-menu-model";
import { Icon } from "@/lib/icon";
import { useShowThinking } from "@/lib/reasoning-visibility";
import { useThreadInstrumentsVisible } from "@/lib/thread-instruments-visibility";
import type { Familiar, SessionRow } from "@/lib/types";
import { FamiliarIcon } from "@/components/familiar-icon";
import { ProjectPickerPopover } from "@/components/project-picker";
import { Popover, PopoverBody, PopoverItem, PopoverLabel, PopoverSeparator } from "@/components/ui/popover";

const ENABLED_MENU_ITEM_SELECTOR =
  '[role="menuitem"]:not(:disabled):not([aria-disabled="true"]), [role="menuitemradio"]:not(:disabled):not([aria-disabled="true"]), [role="menuitemcheckbox"]:not(:disabled):not([aria-disabled="true"])';

/** Slim overflow kebab (cave-zolo): only genuinely secondary tools live here.
 *  Lifecycle verbs (archive, delete) and the voice call are direct header
 *  buttons beside this menu, and rename rides the title's pencil — none of
 *  them are duplicated in the menu. Item lists come from the pure
 *  chat-session-menu-model so the contents are testable without React. */
export function SessionOverflowMenu({
  projects,
  projectId,
  onProjectChange,
  onAddProject,
  registerCurrentRoot,
  onRegisterCurrentRoot,
  sessionId,
  hasTurns,
  onOpenDebug,
  promotableFamiliars,
  onPromoteToCoven,
  reflecting,
  onReflect,
}: {
  projects: CaveProject[];
  projectId: string | null;
  onProjectChange: (value: string) => void;
  /** Opens the shared add-project flow (register + grant) — proactive, not 403-recovery-only. */
  onAddProject?: () => void;
  /** Ad-hoc root the chat runs in — enables the picker's in-place
   *  "Register this folder" row (spec 2026-07-24). */
  registerCurrentRoot?: string;
  onRegisterCurrentRoot?: () => void;
  /** Active conversation id — powers "Continue on phone" (cave-i74f). */
  sessionId?: string | null;
  /** Gates the Show-thinking toggle — pointless on an empty transcript. */
  hasTurns: boolean;
  onOpenDebug: () => void;
  promotableFamiliars: Familiar[];
  onPromoteToCoven: (familiarId: string) => void;
  /** Reflect-on-thread (absent when the familiar has no id). */
  reflecting: boolean;
  onReflect?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [showThinking, setShowThinking] = useShowThinking();
  const [instrumentsVisible, setInstrumentsVisible] = useThreadInstrumentsVisible();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const keyboardOpenRequested = useRef(false);
  const activeProject =
    (projectId ? chatProjectById(projectId, projects) : projects[0]) ?? null;

  const sections = sessionMenuSections({
    sessionId: sessionId ?? null,
    projectPickerAvailable: projects.length > 0 || Boolean(onAddProject),
    projectName: activeProject?.name ?? null,
    projectRoot: activeProject?.root ?? null,
    hasTurns,
    showThinking,
    instrumentsVisible,
    reflectAvailable: Boolean(onReflect),
    reflecting,
  });

  const close = () => setOpen(false);
  const setSessionMenuOpen = useCallback((next: boolean) => {
    if (next) setProjectPickerOpen(false);
    setOpen(next);
  }, []);

  const getEnabledItems = useCallback(
    () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>(ENABLED_MENU_ITEM_SELECTOR) ?? [],
      ),
    [],
  );

  const focusFirstEnabledItem = useCallback(() => {
    keyboardOpenRequested.current = false;
    getEnabledItems()[0]?.focus();
  }, [getEnabledItems]);

  useEffect(() => {
    if (!open || !keyboardOpenRequested.current) return;
    const focusFrame = requestAnimationFrame(focusFirstEnabledItem);
    return () => cancelAnimationFrame(focusFrame);
  }, [focusFirstEnabledItem, open]);

  const onTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        keyboardOpenRequested.current = true;
        e.stopPropagation();
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (open) {
          requestAnimationFrame(focusFirstEnabledItem);
        } else {
          setSessionMenuOpen(true);
        }
      }
    },
    [focusFirstEnabledItem, open, setSessionMenuOpen],
  );

  const onBodyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const items = getEnabledItems();
      if (items.length === 0) return;
      e.preventDefault();
      e.stopPropagation();

      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      let nextIndex: number;
      if (e.key === "Home") nextIndex = 0;
      else if (e.key === "End") nextIndex = items.length - 1;
      else if (e.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
      else nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
      items[nextIndex]?.focus();
    },
    [getEnabledItems],
  );

  const handlers: Record<SessionMenuItemId, () => void> = {
    "continue-on-phone": () => {
      close();
      // Golden path 5: hand off the MOMENT — the pairing modal's QR
      // carries #chat-<id> so one scan opens this conversation.
      window.dispatchEvent(
        new CustomEvent("cave:continue-on-phone", { detail: { chatId: sessionId } }),
      );
    },
    project: () => {
      // Chain popovers: the kebab closes on this click; the picker
      // mounts after it, so its outside-click listener misses the
      // same mousedown and it stays open on the shared anchor.
      close();
      setProjectPickerOpen(true);
    },
    thinking: () => {
      setShowThinking(!showThinking);
      close();
    },
    instruments: () => {
      setInstrumentsVisible(!instrumentsVisible);
      close();
    },
    reflect: () => {
      close();
      onReflect?.();
    },
    debug: () => {
      onOpenDebug();
      close();
    },
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="focus-ring cave-chat-actions-kebab"
        aria-label="Session options"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Session options"
        onPointerDown={() => {
          keyboardOpenRequested.current = false;
        }}
        onKeyDown={onTriggerKeyDown}
        onClick={() => {
          setSessionMenuOpen(!open);
        }}
      >
        <Icon name="ph:dots-three-vertical" width={15} aria-hidden />
      </button>
      <Popover
        open={open}
        onOpenChange={setSessionMenuOpen}
        anchorRef={triggerRef}
        placement="bottom-end"
        minWidth={216}
        ariaLabel="Chat options"
      >
        <div ref={menuRef} onKeyDown={onBodyKeyDown}>
          <PopoverBody role="menu" ariaLabel="Chat options">
            {sections.map((section, si) => (
              <Fragment key={si}>
                {si > 0 ? <PopoverSeparator /> : null}
                {section.map((item) => (
                  <PopoverItem
                    key={item.id}
                    icon={item.icon}
                    checked={item.checked}
                    disabled={item.disabled}
                    title={item.title}
                    onSelect={handlers[item.id]}
                  >
                    {item.label}
                  </PopoverItem>
                ))}
              </Fragment>
            ))}
            {promotableFamiliars.length > 0 ? (
              <>
                <PopoverSeparator />
                <PopoverLabel>Start a coven with</PopoverLabel>
                {promotableFamiliars.map((candidate) => (
                  <PopoverItem
                    key={candidate.id}
                    leading={<span aria-hidden><FamiliarIcon familiar={candidate} size="sm" /></span>}
                    title={`Continue this chat in a coven with ${candidate.display_name}`}
                    onSelect={() => {
                      close();
                      onPromoteToCoven(candidate.id);
                    }}
                  >
                    {candidate.display_name}
                  </PopoverItem>
                ))}
              </>
            ) : null}
          </PopoverBody>
        </div>
      </Popover>
      <ProjectPickerPopover
        open={projectPickerOpen}
        onOpenChange={setProjectPickerOpen}
        anchorRef={triggerRef}
        projects={projects}
        value={projectId}
        onChange={onProjectChange}
        onAddProject={onAddProject}
        registerCurrentRoot={registerCurrentRoot}
        onRegisterCurrentRoot={onRegisterCurrentRoot}
        placement="bottom-end"
        ariaLabel="Project for this chat"
      />
    </>
  );
}

/** Direct danger action (cave-zolo): the trash icon in the header cluster.
 *  Delete is irreversible, so it keeps its confirm step — a small popover on
 *  the button itself instead of a view swap inside the kebab. Quiet at rest:
 *  reveal-on-hover against the chat header's reveal-scope (design language
 *  §8), so the destructive verb earns visibility instead of holding it. */
export function DeleteChatButton({
  deleting,
  onDelete,
}: {
  deleting: boolean;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="focus-ring cave-chat-delete-btn reveal-on-hover"
        aria-label="Delete this chat"
        aria-haspopup="dialog"
        aria-expanded={confirming}
        title="Delete this chat permanently"
        onClick={() => setConfirming(!confirming)}
      >
        <Icon name="ph:trash" width={14} aria-hidden />
      </button>
      <Popover
        open={confirming}
        onOpenChange={setConfirming}
        anchorRef={triggerRef}
        placement="bottom-end"
        minWidth={216}
        ariaLabel="Confirm delete chat"
      >
        <PopoverBody>
          <PopoverLabel>Delete this chat permanently?</PopoverLabel>
          <PopoverItem icon="ph:x" onSelect={() => setConfirming(false)}>
            Cancel
          </PopoverItem>
          <PopoverItem icon="ph:trash" danger disabled={deleting} onSelect={() => onDelete()}>
            {deleting ? "Deleting…" : "Delete chat"}
          </PopoverItem>
        </PopoverBody>
      </Popover>
    </>
  );
}

/** Direct session-lifecycle action (cave-zolo): archive on live sessions,
 *  unarchive on archived ones — the same reversible verb pair the kebab used
 *  to hide. Reversible, so no confirm step (unlike Delete): an archived chat
 *  leaves every rail but stays reachable from the chat list's "Show archived"
 *  toggle. */
export function ArchiveChatButton({
  archived,
  archiving,
  onSetArchived,
}: {
  archived: boolean;
  archiving: boolean;
  onSetArchived: (archived: boolean) => void;
}) {
  const action = archiveAction({ archived, archiving });
  return (
    <button
      type="button"
      className="cave-chat-archive-btn focus-ring"
      onClick={() => onSetArchived(!archived)}
      disabled={archiving}
      aria-label={action.label}
      aria-busy={archiving}
      title={action.title}
    >
      <Icon name={action.icon} width={14} aria-hidden />
    </button>
  );
}

/** Direct voice-call action (cave-zolo): rings the session's familiar without
 *  opening the kebab. Same gating the kebab item had — needs a configured
 *  voice provider, and one call at a time. Reveal-on-hover like the delete
 *  button beside it — the header is the reveal-scope. */
export function VoiceCallButton({
  familiar,
  voiceActive,
  onOpenVoice,
}: {
  familiar: Familiar;
  voiceActive: boolean;
  onOpenVoice: () => void;
}) {
  const action = voiceAction({
    voiceConfigured: Boolean(familiar.voiceProvider),
    voiceActive,
    familiarName: familiar.display_name,
  });
  return (
    <button
      type="button"
      className="focus-ring voice-call-button reveal-on-hover"
      onClick={onOpenVoice}
      disabled={action.disabled}
      aria-label={action.label}
      title={action.label}
    >
      <Icon name="ph:phone" width={14} aria-hidden />
    </button>
  );
}


export function ChatTitleEditable({
  session,
  displayTitleOverride,
  onSessionsChanged,
  headline = false,
  generateTitle,
}: {
  session: SessionRow;
  /** When set, displayed in place of session.title (e.g. to hide a raw
   *  "Task context: …" seed prompt that leaked through as the title). The
   *  edit input still pre-fills with the override so accepting it patches
   *  the canonical title in the daemon/state. */
  displayTitleOverride?: string | null;
  onSessionsChanged?: () => void | Promise<void>;
  /** Render as a full-width all-caps headline row above the context chips
   *  instead of an inline title inside the session chip. */
  headline?: boolean;
  /** Derives a fresh title from the live transcript (cave-quiva). Supplied by
   *  the surface that actually holds the turns; when omitted the sparkle is
   *  not rendered, so title rows without a transcript in scope degrade to the
   *  manual pencil rather than shipping a control that can only no-op. */
  generateTitle?: () => string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const baseTitle = displayTitleOverride ?? session.title ?? "";
  const [value, setValue] = useState(baseTitle);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const submittedRef = useRef(false);
  const mountedRef = useRef(true);
  const onSessionsChangedRef = useRef(onSessionsChanged);
  onSessionsChangedRef.current = onSessionsChanged;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!editing) setValue(baseTitle);
  }, [baseTitle, editing]);

  useEffect(() => {
    if (!editing) return;
    submittedRef.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const refreshSessions = () => {
    if (mountedRef.current) void onSessionsChangedRef.current?.();
  };

  // Rename has two entry points into the same edit mode: the pencil button
  // beside the title and clicking the title text. (The overflow menu's Rename
  // item and its window-event bridge died in cave-zolo — the pencil is the
  // one affordance.)

  const display = baseTitle || session.id;

  // A resolved fetch is not necessarily successful. Only a genuine success or
  // the title CAS conflict contract has authoritative state worth refreshing.
  const patchTitle = async (title: string, ownership: "manual" | "auto" = "manual", replaceManual = false) => {
    try {
      const body = ownership === "auto"
        ? {
            title,
            titleOwnership: "auto" as const,
            autoDefaults: session.title ? [session.title] : [],
            ...(replaceManual && {
              replaceManualTitle: true,
              observedTitle: session.title,
              observedTitleRevision: session.titleRevision ?? 0,
            }),
          }
        : { title };
      const res = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({ ok: res.ok }));
      const titleOwnershipConflict =
        ownership === "auto" &&
        replaceManual &&
        res.status === 409 &&
        json?.ok === false &&
        json?.conflict === true &&
        (json?.title === null || typeof json?.title === "string") &&
        Number.isSafeInteger(json?.titleRevision) &&
        json.titleRevision >= 0;
      if (titleOwnershipConflict) {
        refreshSessions();
        return;
      }
      if (!res.ok || json?.ok === false) return;
      refreshSessions();
    } catch {
      /* transient — next sessions poll will reconcile */
    }
  };

  const submit = async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const trimmed = value.trim();
    setEditing(false);
    if (trimmed === (session.title ?? "").trim()) return;
    await patchTitle(trimmed);
  };

  // Regenerate the name from the transcript. The derivation is pure and
  // synchronous (chat-title-generation.ts) — the visible "generating" state
  // covers the PATCH, not the naming. A null derivation means the thread has
  // nothing to name itself after yet, so the current title is left alone
  // rather than blanked.
  const generate = async () => {
    if (generating) return;
    const next = generateTitle?.()?.trim();
    if (!next) return;
    setGenerating(true);
    try {
      if (next !== (session.title ?? "").trim()) await patchTitle(next, "auto", true);
    } finally {
      if (mountedRef.current) setGenerating(false);
    }
  };

  const cancel = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setValue(baseTitle);
    setEditing(false);
  };

  const inputClassName = headline
    ? "cave-chat-title-input min-w-0 flex-1 rounded-sm bg-transparent text-[length:var(--text-base)] font-semibold uppercase tracking-[0.12em] leading-tight text-[var(--text-primary)] outline-none"
    : "cave-chat-title-input min-w-0 flex-1 rounded-sm bg-transparent text-[length:var(--text-md)] font-semibold leading-tight text-[var(--text-primary)] outline-none";

  // No flex-1 on the title button itself — the wrapper carries the stretch so
  // the pencil sits flush against the title text instead of drifting to the
  // far edge of the free space.
  const buttonClassName = headline
    ? "min-w-0 flex-1 truncate text-left text-[length:var(--text-base)] font-semibold uppercase tracking-[0.12em] leading-tight text-[var(--text-primary)] transition-colors hover:text-[color-mix(in_oklch,var(--accent-presence)_70%,var(--text-primary))]"
    : "min-w-0 truncate text-left text-[length:var(--text-md)] font-semibold leading-tight text-[var(--text-primary)] transition-colors hover:text-[color-mix(in_oklch,var(--accent-presence)_70%,var(--text-primary))]";

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        className={inputClassName}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => void submit()}
        aria-label="Chat title"
        maxLength={200}
      />
    );
  }

  return (
    <span className={headline ? "cave-chat-title flex w-full min-w-0 items-center gap-1.5" : "cave-chat-title flex min-w-0 flex-1 items-center gap-1"}>
      {/* cave-quiva: name-this-chat leads the title row. The glyph stays hidden
          until hover/focus so a settled header reads title-first; the control
          is only rendered when a transcript is actually in scope.
          aria-disabled rather than disabled: a disabled button loses focus the
          instant it flips, dropping a keyboard user who pressed Enter back to
          the body. Re-entry is already blocked in the handler, so the native
          disable buys nothing and costs the focus ring. */}
      {generateTitle ? (
        <button
          type="button"
          className="cave-chat-title-spark focus-ring"
          data-generating={generating ? "true" : undefined}
          title={generating ? "Generating name" : "Generate name"}
          aria-label={generating ? "Generating name" : "Generate name"}
          aria-busy={generating || undefined}
          aria-disabled={generating || undefined}
          onClick={(e) => {
            e.stopPropagation();
            void generate();
          }}
        >
          <Icon name="ph:sparkle" width={11} aria-hidden />
        </button>
      ) : null}
      <button
        type="button"
        className={buttonClassName}
        data-generating={generating ? "true" : undefined}
        title={`${display} — click to rename`}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        {display}
      </button>
      {/* Explicit rename affordance — click-to-rename on the title alone is
          invisible; the pencil makes renaming discoverable without opening
          the overflow menu. */}
      <button
        type="button"
        title="Rename chat"
        aria-label="Rename chat"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className="focus-ring grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--text-muted)] opacity-60 transition-all hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] hover:opacity-100"
      >
        <Icon name="ph:pencil-simple" width={11} aria-hidden />
      </button>
    </span>
  );
}
