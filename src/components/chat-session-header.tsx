"use client";

import { useEffect, useRef, useState } from "react";
import type { CaveProject } from "@/lib/cave-projects";
import { NO_PROJECT_ID, chatProjectById } from "@/lib/chat-projects";
import { Icon } from "@/lib/icon";
import { useShowThinking } from "@/lib/reasoning-visibility";
import type { Familiar, SessionRow } from "@/lib/types";
import { ProjectPickerPopover } from "@/components/project-picker";
import { Popover, PopoverBody, PopoverItem, PopoverLabel, PopoverSeparator } from "@/components/ui/popover";

/** Secondary session controls kept together behind the chat header kebab. */
export function SessionOverflowMenu({
  projects, projectId, onProjectChange, onAddProject, familiar, sessionId, hasTurns,
  voiceActive, onOpenVoice, onOpenDebug, reflecting, onReflect, deleting, onDelete,
  archived, archiving, onSetArchived,
}: {
  projects: CaveProject[];
  projectId: string | null;
  onProjectChange: (value: string) => void;
  onAddProject?: () => void;
  familiar: Familiar;
  sessionId?: string | null;
  hasTurns: boolean;
  voiceActive: boolean;
  onOpenVoice: () => void;
  onOpenDebug: () => void;
  reflecting: boolean;
  onReflect?: () => void;
  deleting: boolean;
  onDelete: () => void;
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
      <button ref={triggerRef} type="button" className="focus-ring cave-chat-actions-kebab"
        aria-label="Session options" aria-haspopup="menu" aria-expanded={open} title="Session options"
        onClick={() => { setProjectPickerOpen(false); if (open) close(); else setOpen(true); }}>
        <Icon name="ph:dots-three-vertical" width={15} aria-hidden />
      </button>
      <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}
        anchorRef={triggerRef} placement="bottom-end" minWidth={216} ariaLabel="Chat options">
        {confirmingDelete ? (
          <PopoverBody>
            <PopoverLabel>Delete this chat permanently?</PopoverLabel>
            <PopoverItem icon="ph:x" onSelect={() => setConfirmingDelete(false)}>Cancel</PopoverItem>
            <PopoverItem icon="ph:trash" danger disabled={deleting} onSelect={() => onDelete()}>{deleting ? "Deleting…" : "Delete chat"}</PopoverItem>
          </PopoverBody>
        ) : (
          <PopoverBody>
            {sessionId ? <PopoverItem icon="ph:device-mobile" onSelect={() => {
              close(); window.dispatchEvent(new CustomEvent("cave:continue-on-phone", { detail: { chatId: sessionId } }));
            }}>Continue on phone</PopoverItem> : null}
            <PopoverItem icon="ph:pencil-simple" onSelect={() => { window.dispatchEvent(new Event("cave:chat-rename")); close(); }}>Rename chat</PopoverItem>
            {projects.length > 0 || onAddProject ? <PopoverItem icon="ph:folder" title={activeProject?.root ?? "No project"} onSelect={() => {
              close(); setProjectPickerOpen(true);
            }}>Project: {activeProject ? activeProject.name : "No project"}</PopoverItem> : null}
            <PopoverSeparator />
            {hasTurns ? <PopoverItem icon={showThinking ? "ph:brain-bold" : "ph:brain"} checked={showThinking}
              title={showThinking ? "Hide reasoning blocks" : "Show reasoning blocks"} onSelect={() => { setShowThinking(!showThinking); close(); }}>
              {showThinking ? "Hide thinking" : "Show thinking"}
            </PopoverItem> : null}
            {onReflect ? <PopoverItem icon={reflecting ? "ph:circle-notch-bold" : "ph:sparkle-bold"} disabled={reflecting}
              onSelect={() => { close(); onReflect(); }}>{reflecting ? "Reflecting…" : "Reflect on this thread"}</PopoverItem> : null}
            <PopoverItem icon="ph:phone" disabled={!voiceConfigured || voiceActive} onSelect={() => { onOpenVoice(); close(); }}>
              {voiceConfigured ? `Call ${familiar.display_name}` : "Voice — set up in Studio"}
            </PopoverItem>
            <PopoverItem icon="ph:bug-bold" onSelect={() => { onOpenDebug(); close(); }}>Debug session</PopoverItem>
            <PopoverSeparator />
            {sessionId ? <PopoverItem icon="ph:archive" disabled={archiving}
              title={archived ? "Restore this chat to the rail" : "Archive this chat — it leaves the rail but is never deleted"}
              onSelect={() => { onSetArchived(!archived); close(); }}>
              {archiving ? (archived ? "Unarchiving…" : "Archiving…") : archived ? "Unarchive chat" : "Archive chat"}
            </PopoverItem> : null}
            <PopoverItem icon="ph:trash" danger onSelect={() => setConfirmingDelete(true)}>Delete chat…</PopoverItem>
          </PopoverBody>
        )}
      </Popover>
      <ProjectPickerPopover open={projectPickerOpen} onOpenChange={setProjectPickerOpen} anchorRef={triggerRef}
        projects={projects} value={projectId} onChange={onProjectChange} allowNoProject onAddProject={onAddProject}
        placement="bottom-end" ariaLabel="Project for this chat" />
    </>
  );
}

/** Inline chat-title editor shared by the session header and its menu command. */
export function ChatTitleEditable({ session, displayTitleOverride, onSessionsChanged, headline = false }: {
  session: SessionRow;
  displayTitleOverride?: string | null;
  onSessionsChanged?: () => void;
  headline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const baseTitle = displayTitleOverride ?? session.title ?? "";
  const [value, setValue] = useState(baseTitle);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const submittedRef = useRef(false);
  useEffect(() => { if (!editing) setValue(baseTitle); }, [baseTitle, editing]);
  useEffect(() => { if (!editing) return; submittedRef.current = false; inputRef.current?.focus(); inputRef.current?.select(); }, [editing]);
  useEffect(() => { const onRename = () => setEditing(true); window.addEventListener("cave:chat-rename", onRename); return () => window.removeEventListener("cave:chat-rename", onRename); }, []);
  const display = baseTitle || session.id;
  const submit = async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const trimmed = value.trim();
    setEditing(false);
    if (trimmed === (session.title ?? "").trim()) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: trimmed }) });
      onSessionsChanged?.();
    } catch { /* transient — next sessions poll will reconcile */ }
  };
  const cancel = () => { if (submittedRef.current) return; submittedRef.current = true; setValue(baseTitle); setEditing(false); };
  const inputClassName = headline
    ? "cave-chat-title-input min-w-0 flex-1 rounded-sm bg-transparent text-[length:var(--text-base)] font-semibold uppercase tracking-[0.12em] leading-tight text-[var(--text-primary)] outline-none"
    : "cave-chat-title-input min-w-0 flex-1 rounded-sm bg-transparent text-[length:var(--text-md)] font-semibold leading-tight text-[var(--text-primary)] outline-none";
  const buttonClassName = headline
    ? "min-w-0 flex-1 truncate text-left text-[length:var(--text-base)] font-semibold uppercase tracking-[0.12em] leading-tight text-[var(--text-primary)] transition-colors hover:text-[color-mix(in_oklch,var(--accent-presence)_70%,var(--text-primary))]"
    : "min-w-0 truncate text-left text-[length:var(--text-md)] font-semibold leading-tight text-[var(--text-primary)] transition-colors hover:text-[color-mix(in_oklch,var(--accent-presence)_70%,var(--text-primary))]";
  if (editing) return <input ref={inputRef} type="text" className={inputClassName} value={value} onChange={(e) => setValue(e.target.value)} onClick={(e) => e.stopPropagation()}
    onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); void submit(); } else if (e.key === "Escape") { e.preventDefault(); cancel(); } }} onBlur={() => void submit()} aria-label="Chat title" maxLength={200} />;
  return <span className={headline ? "cave-chat-title flex w-full min-w-0 items-center gap-1.5" : "cave-chat-title flex min-w-0 flex-1 items-center gap-1"}>
    <button type="button" className={buttonClassName} title={`${display} — click to rename`} onClick={(e) => { e.stopPropagation(); setEditing(true); }}>{display}</button>
    <button type="button" title="Rename chat" aria-label="Rename chat" onClick={(e) => { e.stopPropagation(); setEditing(true); }} className="focus-ring grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--text-muted)] opacity-60 transition-all hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] hover:opacity-100"><Icon name="ph:pencil-simple" width={11} aria-hidden /></button>
  </span>;
}
