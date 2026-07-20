"use client";

import { useEffect, useRef, useState } from "react";
import type { CaveProject } from "@/lib/cave-projects";
import { NO_PROJECT_ID, chatProjectById } from "@/lib/chat-projects";
import { Icon } from "@/lib/icon";
import { useShowThinking } from "@/lib/reasoning-visibility";
import type { Familiar, SessionRow } from "@/lib/types";
import { ProjectPickerPopover } from "@/components/project-picker";
import { Popover, PopoverBody, PopoverItem, PopoverLabel, PopoverSeparator } from "@/components/ui/popover";

export function SessionOverflowMenu({
  projects,
  projectId,
  onProjectChange,
  onAddProject,
  familiar,
  sessionId,
  hasTurns,
  voiceActive,
  onOpenVoice,
  onOpenDebug,
  reflecting,
  onReflect,
  deleting,
  onDelete,
  archived,
  archiving,
  onSetArchived,
}: {
  projects: CaveProject[];
  projectId: string | null;
  onProjectChange: (value: string) => void;
  /** Opens the shared add-project flow (register + grant) — proactive, not 403-recovery-only. */
  onAddProject?: () => void;
  familiar: Familiar;
  /** Active conversation id — powers "Continue on phone" (cave-i74f). */
  sessionId?: string | null;
  /** Gates the Show-thinking toggle — pointless on an empty transcript. */
  hasTurns: boolean;
  voiceActive: boolean;
  onOpenVoice: () => void;
  onOpenDebug: () => void;
  /** Reflect-on-thread (absent when the familiar has no id). */
  reflecting: boolean;
  onReflect?: () => void;
  deleting: boolean;
  onDelete: () => void;
  /** Whether this session is archived — flips the menu item to Unarchive. */
  archived: boolean;
  archiving: boolean;
  onSetArchived: (archived: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showThinking, setShowThinking] = useShowThinking();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const activeProject =
    projectId === NO_PROJECT_ID
      ? null
      : (projectId ? chatProjectById(projectId, projects) ?? projects[0] : projects[0]) ?? null;
  const voiceConfigured = Boolean(familiar.voiceProvider);

  const close = () => {
    setOpen(false);
    setConfirmingDelete(false);
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
        onClick={() => {
          // The picker shares this anchor, so its outside-click handler skips
          // clicks here — close it explicitly or both popovers stack open.
          setProjectPickerOpen(false);
          if (open) close();
          else setOpen(true);
        }}
      >
        <Icon name="ph:dots-three-vertical" width={15} aria-hidden />
      </button>
      <Popover
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        anchorRef={triggerRef}
        placement="bottom-end"
        minWidth={216}
        ariaLabel="Chat options"
      >
        {confirmingDelete ? (
          <PopoverBody>
            <PopoverLabel>Delete this chat permanently?</PopoverLabel>
            <PopoverItem icon="ph:x" onSelect={() => setConfirmingDelete(false)}>
              Cancel
            </PopoverItem>
            <PopoverItem icon="ph:trash" danger disabled={deleting} onSelect={() => onDelete()}>
              {deleting ? "Deleting…" : "Delete chat"}
            </PopoverItem>
          </PopoverBody>
        ) : (
          <PopoverBody>
            {sessionId ? (
              <PopoverItem
                icon="ph:device-mobile"
                onSelect={() => {
                  close();
                  // Golden path 5: hand off the MOMENT — the pairing modal's QR
                  // carries #chat-<id> so one scan opens this conversation.
                  window.dispatchEvent(
                    new CustomEvent("cave:continue-on-phone", { detail: { chatId: sessionId } }),
                  );
                }}
              >
                Continue on phone
              </PopoverItem>
            ) : null}
            <PopoverItem
              icon="ph:pencil-simple"
              onSelect={() => {
                window.dispatchEvent(new Event("cave:chat-rename"));
                close();
              }}
            >
              Rename chat
            </PopoverItem>
            {projects.length > 0 || onAddProject ? (
              <PopoverItem
                icon="ph:folder"
                title={activeProject?.root ?? "No project"}
                onSelect={() => {
                  // Chain popovers: the kebab closes on this click; the picker
                  // mounts after it, so its outside-click listener misses the
                  // same mousedown and it stays open on the shared anchor.
                  close();
                  setProjectPickerOpen(true);
                }}
              >
                Project: {activeProject ? activeProject.name : "No project"}
              </PopoverItem>
            ) : null}
            <PopoverSeparator />
            {hasTurns ? (
              <PopoverItem
                icon={showThinking ? "ph:brain-bold" : "ph:brain"}
                checked={showThinking}
                title={showThinking ? "Hide reasoning blocks" : "Show reasoning blocks"}
                onSelect={() => {
                  setShowThinking(!showThinking);
                  close();
                }}
              >
                {showThinking ? "Hide thinking" : "Show thinking"}
              </PopoverItem>
            ) : null}
            {onReflect ? (
              <PopoverItem
                icon={reflecting ? "ph:circle-notch-bold" : "ph:sparkle-bold"}
                disabled={reflecting}
                onSelect={() => {
                  close();
                  onReflect();
                }}
              >
                {reflecting ? "Reflecting…" : "Reflect on this thread"}
              </PopoverItem>
            ) : null}
            <PopoverItem
              icon="ph:phone"
              disabled={!voiceConfigured || voiceActive}
              onSelect={() => {
                onOpenVoice();
                close();
              }}
            >
              {voiceConfigured ? `Call ${familiar.display_name}` : "Voice — set up in Studio"}
            </PopoverItem>
            <PopoverItem
              icon="ph:bug-bold"
              onSelect={() => {
                onOpenDebug();
                close();
              }}
            >
              Debug session
            </PopoverItem>
            <PopoverSeparator />
            {sessionId ? (
              // Reversible, so no confirm step (unlike Delete below): an
              // archived chat leaves every rail but stays reachable from the
              // chat list's "Show archived" toggle, where this same item
              // reads Unarchive.
              <PopoverItem
                icon="ph:archive"
                disabled={archiving}
                title={archived ? "Restore this chat to the rail" : "Archive this chat — it leaves the rail but is never deleted"}
                onSelect={() => {
                  onSetArchived(!archived);
                  close();
                }}
              >
                {archiving ? (archived ? "Unarchiving…" : "Archiving…") : archived ? "Unarchive chat" : "Archive chat"}
              </PopoverItem>
            ) : null}
            <PopoverItem icon="ph:trash" danger onSelect={() => setConfirmingDelete(true)}>
              Delete chat…
            </PopoverItem>
          </PopoverBody>
        )}
      </Popover>
      <ProjectPickerPopover
        open={projectPickerOpen}
        onOpenChange={setProjectPickerOpen}
        anchorRef={triggerRef}
        projects={projects}
        value={projectId}
        onChange={onProjectChange}
        allowNoProject
        onAddProject={onAddProject}
        placement="bottom-end"
        ariaLabel="Project for this chat"
      />
    </>
  );
}


export function ChatTitleEditable({
  session,
  displayTitleOverride,
  onSessionsChanged,
  headline = false,
}: {
  session: SessionRow;
  /** When set, displayed in place of session.title (e.g. to hide a raw
   *  "Task context: …" seed prompt that leaked through as the title). The
   *  edit input still pre-fills with the override so accepting it patches
   *  the canonical title in the daemon/state. */
  displayTitleOverride?: string | null;
  onSessionsChanged?: () => void;
  /** Render as a full-width all-caps headline row above the context chips
   *  instead of an inline title inside the session chip. */
  headline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const baseTitle = displayTitleOverride ?? session.title ?? "";
  const [value, setValue] = useState(baseTitle);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (!editing) setValue(baseTitle);
  }, [baseTitle, editing]);

  useEffect(() => {
    if (!editing) return;
    submittedRef.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  // Rename has three entry points into the same edit mode: the pencil button
  // beside the title, clicking the title text, and the session overflow menu —
  // which lives outside this component and reaches it via this window event.
  useEffect(() => {
    const onRename = () => setEditing(true);
    window.addEventListener("cave:chat-rename", onRename);
    return () => window.removeEventListener("cave:chat-rename", onRename);
  }, []);

  const display = baseTitle || session.id;

  const submit = async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const trimmed = value.trim();
    setEditing(false);
    if (trimmed === (session.title ?? "").trim()) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      onSessionsChanged?.();
    } catch {
      /* transient — next sessions poll will reconcile */
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
      <button
        type="button"
        className={buttonClassName}
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
