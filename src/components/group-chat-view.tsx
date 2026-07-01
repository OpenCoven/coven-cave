"use client";

/**
 * GroupChatView — the "coven" group-chat surface.
 *
 * A coven is a saved set of familiars you talk to together. A prompt is
 * broadcast to every participant in parallel; each familiar answers in its own
 * resumable `/api/chat/send` session and its reply is attributed inline. This
 * mirrors the daemon/coven-CLI model — there is no server-side "group session",
 * so the group lives client-side and simply pins one session id per familiar
 * (the same fan-out the iOS app uses).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "@/lib/icon";
import { extractNextPaths } from "@/lib/next-paths";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Popover } from "@/components/ui/popover";
import { MessageBubble } from "@/components/message-bubble";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { RelativeTime } from "@/components/ui/relative-time";
import { UserChatAvatar } from "@/components/user-chat-avatar";
import { formatChatRecency, useDateTimePrefs } from "@/lib/datetime-format";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  applyGroupEvent,
  parseSseBuffer,
  defaultGroupName,
  makeGroup,
  upsertGroup,
  removeGroup,
  setGroupSession,
  setGroupParticipants,
  parseMentions,
  renderCovenRoundtablePrompt,
  findActiveMention,
  matchMentions,
  applyMention,
  loadGroups,
  saveGroups,
  loadTranscript,
  saveTranscript,
  type CovenGroup,
  type GroupTurn,
  type GroupUserTurn,
  type GroupReply,
  type MentionableFamiliar,
  type RosterParticipant,
} from "@/lib/group-chat";

type Props = {
  familiars: ResolvedFamiliar[];
  /** Called whenever a participant's session is (re)created, so the host can
   *  refresh its session list and surface the new threads elsewhere. */
  onSessionStarted?: (sessionId: string) => void;
  onOpenUrl?: (url: string) => void;
};

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Math.floor(Math.random() * 1e9)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function GroupChatView({ familiars, onSessionStarted, onOpenUrl }: Props) {
  const [groups, setGroups] = useState<CovenGroup[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<GroupTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // @mention autocomplete in the composer.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const dtPrefs = useDateTimePrefs();

  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Caret to restore after we programmatically rewrite the draft (mention insert).
  const pendingCaretRef = useRef<number | null>(null);
  const groupsRef = useRef<CovenGroup[]>(groups);
  groupsRef.current = groups;

  const byId = useMemo(() => {
    const m = new Map<string, ResolvedFamiliar>();
    for (const f of familiars) m.set(f.id, f);
    return m;
  }, [familiars]);

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeId) ?? null,
    [groups, activeId],
  );
  const activeGroupRef = useRef<CovenGroup | null>(activeGroup);
  activeGroupRef.current = activeGroup;

  // --- load persisted groups once -----------------------------------------
  useEffect(() => {
    const loaded = loadGroups();
    setGroups(loaded);
    if (loaded.length > 0) setActiveId(loaded[0].id);
  }, []);

  // --- swap transcript when the active group changes ----------------------
  useEffect(() => {
    if (!activeId) {
      setTranscript([]);
      return;
    }
    setTranscript(loadTranscript(activeId));
  }, [activeId]);

  // --- persist transcript on settle ---------------------------------------
  useEffect(() => {
    if (activeId) saveTranscript(activeId, transcript);
  }, [activeId, transcript]);

  // --- autoscroll to newest -----------------------------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  // --- restore caret after a programmatic draft rewrite (mention insert) ---
  useEffect(() => {
    const caret = pendingCaretRef.current;
    if (caret == null) return;
    pendingCaretRef.current = null;
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(caret, caret);
    }
  }, [draft]);

  const persistGroups = useCallback((next: CovenGroup[]) => {
    setGroups(next);
    saveGroups(next);
  }, []);

  const updateReply = useCallback(
    (replyId: string, fn: (r: GroupReply) => GroupReply) => {
      setTranscript((prev) =>
        prev.map((t) =>
          t.role === "assistant" && t.id === replyId ? fn(t as GroupReply) : t,
        ),
      );
    },
    [],
  );

  const recordSession = useCallback(
    (groupId: string, familiarId: string, sessionId: string) => {
      const current = groupsRef.current.find((g) => g.id === groupId);
      if (!current || current.sessions[familiarId] === sessionId) return;
      persistGroups(
        upsertGroup(groupsRef.current, setGroupSession(current, familiarId, sessionId, nowIso())),
      );
      onSessionStarted?.(sessionId);
    },
    [persistGroups, onSessionStarted],
  );

  // --- group CRUD ----------------------------------------------------------
  const createGroup = useCallback(() => {
    const group = makeGroup("New coven", [], nowIso(), newId());
    persistGroups(upsertGroup(groupsRef.current, group));
    setActiveId(group.id);
    setPickerOpen(true);
  }, [persistGroups]);

  const deleteGroup = useCallback(
    (id: string) => {
      const next = removeGroup(groupsRef.current, id);
      persistGroups(next);
      if (typeof localStorage !== "undefined") {
        try {
          localStorage.removeItem(`cave:group-chat:transcript:${id}`);
        } catch {
          /* ignore */
        }
      }
      if (activeId === id) setActiveId(next[0]?.id ?? null);
    },
    [persistGroups, activeId],
  );

  const toggleParticipant = useCallback(
    (familiarId: string) => {
      const group = activeGroupRef.current;
      if (!group) return;
      const has = group.familiarIds.includes(familiarId);
      const ids = has
        ? group.familiarIds.filter((id) => id !== familiarId)
        : [...group.familiarIds, familiarId];
      // Keep auto-naming from the roster until the user types their own name.
      // "Auto" means the current name still matches what the previous roster
      // would have produced (or the untouched default / empty).
      const prevAutoName = defaultGroupName(group.familiarIds.map((id) => byId.get(id)?.display_name ?? ""));
      const autoNamed =
        group.name === "New coven" || group.name.trim() === "" || group.name === prevAutoName;
      let next = setGroupParticipants(group, ids, nowIso());
      if (autoNamed) {
        next = {
          ...next,
          name: defaultGroupName(ids.map((id) => byId.get(id)?.display_name ?? "")),
        };
      }
      persistGroups(upsertGroup(groupsRef.current, next));
    },
    [persistGroups, byId],
  );

  const renameGroup = useCallback(
    (name: string) => {
      const group = activeGroupRef.current;
      if (!group) return;
      persistGroups(
        upsertGroup(groupsRef.current, { ...group, name: name.trim() || "Untitled coven", updatedAt: nowIso() }),
      );
    },
    [persistGroups],
  );

  // --- broadcast send ------------------------------------------------------
  const streamOne = useCallback(
    async (group: CovenGroup, reply: GroupReply, prompt: string, signal: AbortSignal): Promise<GroupReply> => {
      // `settled` mirrors the live React state so callers can await the final
      // reply state without waiting for React to render. Apply every update to both.
      let settled = reply;
      const apply = (fn: (r: GroupReply) => GroupReply) => {
        settled = fn(settled);
        updateReply(reply.id, fn);
      };
      try {
        const res = await fetch("/api/chat/send", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            familiarId: reply.familiarId,
            prompt,
            sessionId: reply.sessionId,
          }),
          signal,
        });
        if (!res.ok || !res.body) {
          apply((r) => applyGroupEvent(r, { kind: "error", message: `request failed (${res.status})` }));
          return settled;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = parseSseBuffer(buffer);
          buffer = rest;
          for (const ev of events) {
            if (ev.kind === "session") recordSession(group.id, reply.familiarId, ev.sessionId);
            if (ev.kind === "done" && ev.sessionId)
              recordSession(group.id, reply.familiarId, ev.sessionId);
            apply((r) => applyGroupEvent(r, ev));
          }
        }
        // Stream closed without an explicit `done` — settle anything still live.
        apply((r) =>
          r.status === "streaming" || r.status === "queued" ? { ...r, status: "done", activity: undefined } : r,
        );
      } catch (err) {
        const aborted = (err as Error)?.name === "AbortError";
        apply((r) =>
          aborted
            ? { ...r, status: "error", error: "cancelled", activity: undefined }
            : applyGroupEvent(r, { kind: "error", message: (err as Error)?.message ?? "send failed" }),
        );
      }
      return settled;
    },
    [updateReply, recordSession],
  );

  const broadcast = useCallback(
    async (rawText: string) => {
      const group = activeGroupRef.current;
      const text = rawText.trim();
      if (!group || group.familiarIds.length === 0 || !text || busy || abortRef.current) return;
      // Tagging a subset of familiars with `@mentions` targets the message at just
      // those participants; with no mention it broadcasts to the whole coven.
      const mentionable: MentionableFamiliar[] = group.familiarIds.map((id) => ({
        id,
        name: byId.get(id)?.display_name ?? "",
      }));
      const mentioned = parseMentions(text, mentionable);
      const targetIds = mentioned.length > 0 ? group.familiarIds.filter((id) => mentioned.includes(id)) : group.familiarIds;
      // Roster reflects the FULL coven (not just @mention targets) — a familiar
      // should know who else is in the room even when addressed alone. Composed
      // per-familiar so each sees itself marked "(you)".
      const rosterParticipants: RosterParticipant[] = [
        ...group.familiarIds.map((id) => ({
          id,
          name: byId.get(id)?.display_name ?? id,
          role: byId.get(id)?.role ?? "",
          kind: "familiar" as const,
        })),
        { id: "__human__", name: "You", role: "", kind: "human" as const },
      ];
      const at = nowIso();
      const userTurn: GroupUserTurn = {
        id: newId(),
        role: "user",
        text,
        targetFamiliarIds: mentioned.length > 0 ? targetIds : undefined,
        createdAt: at,
      };
      const replies: GroupReply[] = targetIds.map((fid) => ({
        id: newId(),
        role: "assistant",
        familiarId: fid,
        replyTo: userTurn.id,
        sessionId: group.sessions[fid] ?? null,
        text: "",
        status: "queued",
        createdAt: at,
      }));
      setTranscript((prev) => [...prev, userTurn, ...replies]);
      setDraft("");
      setMention(null);
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      await Promise.all(
        replies.map((r) =>
          streamOne(
            group,
            r,
            renderCovenRoundtablePrompt({
              participants: rosterParticipants,
              receivingFamiliarId: r.familiarId,
              userText: text,
              targeted: mentioned.length > 0,
            }),
            controller.signal,
          ),
        ),
      );
      abortRef.current = null;
      setBusy(false);
    },
    [busy, streamOne, byId],
  );

  // The composer and "click a next-path suggestion to send" chips both go
  // through broadcast — a clicked suggestion is just a one-tap next prompt.
  const send = useCallback(() => broadcast(draft), [broadcast, draft]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // --- @mention autocomplete ----------------------------------------------
  const mentionable = useMemo<MentionableFamiliar[]>(() => {
    if (!activeGroup) return [];
    return activeGroup.familiarIds
      .map((id) => byId.get(id))
      .filter((f): f is ResolvedFamiliar => Boolean(f))
      .map((f) => ({ id: f.id, name: f.display_name }));
  }, [activeGroup, byId]);
  const mentionMatches = useMemo(
    () => (mention ? matchMentions(mention.query, mentionable) : []),
    [mention, mentionable],
  );
  const mentionOpen = mention !== null && mentionMatches.length > 0;

  // Recompute the active mention token from the textarea's current caret.
  const syncMention = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const next = findActiveMention(el.value, el.selectionStart ?? el.value.length);
    setMention(next);
    setMentionIndex(0);
  }, []);

  const chooseMention = useCallback(
    (f: MentionableFamiliar) => {
      if (!mention) return;
      const { text, caret } = applyMention(draft, mention.start, mention.query, f.name);
      pendingCaretRef.current = caret;
      setDraft(text);
      setMention(null);
    },
    [mention, draft],
  );

  // --- derived transcript view --------------------------------------------
  // Group replies under the user turn they answer for a clean threaded layout.
  const threads = useMemo(() => {
    const users = transcript.filter((t): t is GroupUserTurn => t.role === "user");
    return users.map((u) => ({
      user: u,
      replies: transcript.filter(
        (t): t is GroupReply => t.role === "assistant" && t.replyTo === u.id,
      ),
    }));
  }, [transcript]);

  const participants = activeGroup
    ? activeGroup.familiarIds.map((id) => byId.get(id)).filter(Boolean as unknown as (f: ResolvedFamiliar | undefined) => f is ResolvedFamiliar)
    : [];

  // --- render --------------------------------------------------------------
  return (
    <div className="cave-group-chat-shell flex h-full min-h-0">
      {/* Coven list rail */}
      <aside className="cave-group-chat-rail flex w-56 shrink-0 flex-col border-r" style={{ borderColor: "var(--border-hairline)" }}>
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Covens
          </span>
          <Button size="xs" variant="ghost" leadingIcon="ph:plus-bold" onClick={createGroup}>
            New
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {groups.length === 0 ? (
            <p className="px-2 py-3 text-[12px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
              A coven is a group of familiars you talk to together. Create one to broadcast a prompt to all of them at once.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {groups.map((g) => {
                const members = g.familiarIds.map((id) => byId.get(id)).filter(Boolean) as ResolvedFamiliar[];
                const isActive = g.id === activeId;
                return (
                  <li key={g.id}>
                    <div
                      className="group/coven flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5"
                      style={isActive ? { background: "var(--bg-raised)" } : undefined}
                      onClick={() => setActiveId(g.id)}
                    >
                      <div className="flex -space-x-1.5">
                        {members.slice(0, 3).map((m) => (
                          <FamiliarAvatar key={m.id} familiar={m} size="sm" className="rounded-full ring-1 ring-[var(--bg-base)] object-cover" />
                        ))}
                        {members.length === 0 && (
                          <span className="grid h-4 w-4 place-items-center rounded-full" style={{ background: "var(--bg-raised)" }}>
                            <Icon name="ph:users-three" width={11} height={11} />
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px]" style={{ color: "var(--text-primary)" }} title={g.name}>
                          {g.name}
                        </div>
                        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {members.length} familiar{members.length === 1 ? "" : "s"} · <RelativeTime iso={g.updatedAt} />
                        </div>
                      </div>
                      <button
                        type="button"
                        className="opacity-0 transition-opacity group-hover/coven:opacity-100"
                        title="Delete coven"
                        aria-label={`Delete ${g.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteGroup(g.id);
                        }}
                      >
                        <Icon name="ph:trash" width={14} height={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Active coven */}
      <section className="cave-group-chat-main flex min-w-0 flex-1 flex-col">
        {!activeGroup ? (
          <div className="grid flex-1 place-items-center">
            <EmptyState
              icon="ph:users-three"
              headline="No coven selected"
              subtitle="Create a coven to chat with several familiars at once. Each one answers in its own session, attributed inline."
              actions={
                <Button variant="primary" leadingIcon="ph:plus-bold" onClick={createGroup}>
                  New coven
                </Button>
              }
            />
          </div>
        ) : (
          <>
            {/* Header */}
            <header className="flex items-center gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--border-hairline)" }}>
              <div className="min-w-0 flex-1">
                {renaming ? (
                  <input
                    autoFocus
                    defaultValue={activeGroup.name}
                    className="w-full rounded bg-transparent text-[15px] font-semibold outline-none"
                    style={{ color: "var(--text-primary)" }}
                    onBlur={(e) => {
                      renameGroup(e.target.value);
                      setRenaming(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setRenaming(false);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="truncate text-[15px] font-semibold"
                    style={{ color: "var(--text-primary)" }}
                    title="Rename coven"
                    onClick={() => setRenaming(true)}
                  >
                    {activeGroup.name}
                  </button>
                )}
                <div className="mt-0.5 flex items-center gap-1.5">
                  {participants.length === 0 ? (
                    <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                      No familiars yet — add some to start
                    </span>
                  ) : (
                    participants.map((f) => (
                      <span key={f.id} className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px]" style={{ background: "var(--bg-raised)", color: "var(--text-secondary)" }}>
                        <FamiliarAvatar familiar={f} size="sm" className="rounded-full object-cover" />
                        {f.display_name}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <Button
                ref={addBtnRef}
                size="sm"
                variant="secondary"
                leadingIcon="ph:plus-bold"
                onClick={() => setPickerOpen((v) => !v)}
              >
                Add
              </Button>
              <Popover
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                anchorRef={addBtnRef}
                placement="bottom-end"
                ariaLabel="Choose familiars"
                minWidth={240}
              >
                <div className="max-h-80 overflow-y-auto p-1">
                  {familiars.length === 0 ? (
                    <p className="px-2 py-2 text-[12px]" style={{ color: "var(--text-muted)" }}>
                      No familiars available.
                    </p>
                  ) : (
                    familiars.map((f) => {
                      const checked = activeGroup.familiarIds.includes(f.id);
                      return (
                        <button
                          key={f.id}
                          type="button"
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--bg-raised)]"
                          onClick={() => toggleParticipant(f.id)}
                        >
                          <FamiliarAvatar familiar={f} size="md" className="rounded-full object-cover" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px]" style={{ color: "var(--text-primary)" }}>{f.display_name}</div>
                            <div className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>{f.role}</div>
                          </div>
                          <Icon
                            name={checked ? "ph:check-circle-fill" : "ph:circle"}
                            width={18}
                            height={18}
                            className={checked ? "text-[var(--accent-presence)]" : "text-[var(--text-muted)]"}
                          />
                        </button>
                      );
                    })
                  )}
                </div>
              </Popover>
            </header>

            {/* Transcript */}
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {threads.length === 0 ? (
                <div className="grid h-full place-items-center">
                  <EmptyState
                    icon="ph:chats-circle"
                    headline={participants.length === 0 ? "Add familiars to begin" : "Broadcast your first message"}
                    subtitle={
                      participants.length === 0
                        ? "Use Add to pick the familiars in this coven."
                        : "Your prompt goes to every familiar in the coven. Each replies in its own thread."
                    }
                    compact
                  />
                </div>
              ) : (
                <div className="mx-auto flex max-w-3xl flex-col gap-5">
                  {threads.map(({ user, replies }) => {
                    const targets = user.targetFamiliarIds
                      ?.map((id) => byId.get(id))
                      .filter((f): f is ResolvedFamiliar => Boolean(f));
                    return (
                    <div key={user.id} className="flex flex-col gap-2">
                      {targets && targets.length > 0 && (
                        <div className="flex items-center gap-1.5 self-end text-[11px]" style={{ color: "var(--text-muted)" }}>
                          <Icon name="ph:at" width={12} height={12} />
                          <span>
                            to {targets.map((f) => f.display_name).join(", ")}
                          </span>
                        </div>
                      )}
                      <div className="cave-group-chat-turn cave-group-chat-turn--user">
                        <UserChatAvatar className="cave-group-chat-avatar cave-group-chat-avatar--human" />
                        <div className="cave-group-chat-message">
                          <div className="cave-group-chat-meta">
                            <span className="cave-group-chat-name">You</span>
                            <span className="cave-group-chat-badge cave-group-chat-badge--op">OP</span>
                            <time className="cave-group-chat-recency" dateTime={user.createdAt}>
                              {formatChatRecency(user.createdAt, dtPrefs)}
                            </time>
                          </div>
                          <MessageBubble role="user" content={user.text} timestamp={user.createdAt} showTimestamp={false} onOpenUrl={onOpenUrl} />
                        </div>
                      </div>
                      <div className="flex flex-col gap-3 pl-1">
                        {replies.map((r) => {
                          const f = byId.get(r.familiarId);
                          // Strip the piggybacked `<coven:next-paths>` suggestions
                          // block (and its streaming partial) from the visible
                          // reply, mirroring the single-chat surface; otherwise
                          // the raw control markup leaks into the coven bubble.
                          // The parsed lines render as click-to-send chips below.
                          const { visible: visibleText, suggestions } = extractNextPaths(r.text);
                          return (
                            <div key={r.id} className="cave-group-chat-turn cave-group-chat-turn--assistant">
                              <div className="cave-group-chat-avatar">
                                {f ? (
                                  <FamiliarAvatar familiar={f} size="xl" className="cave-group-chat-avatar__image" title={f.display_name} />
                                ) : (
                                  <Icon name="ph:sparkle" width={24} height={24} />
                                )}
                              </div>
                              <div className="cave-group-chat-message">
                                <div className="cave-group-chat-meta">
                                  <span className="cave-group-chat-name">{f?.display_name ?? r.familiarId}</span>
                                  <span className="cave-group-chat-crest" aria-hidden="true">
                                    <Icon name="ph:sparkle" width={13} height={13} />
                                  </span>
                                  {f?.role ? <span className="cave-group-chat-badge">{f.role}</span> : null}
                                  <time className="cave-group-chat-recency" dateTime={r.createdAt}>
                                    {formatChatRecency(r.createdAt, dtPrefs)}
                                  </time>
                                </div>
                                <MessageBubble
                                  role="assistant"
                                  label={f?.display_name ?? r.familiarId}
                                  content={
                                    visibleText ||
                                    (r.status === "error"
                                      ? `⚠️ ${r.error ?? "failed"}`
                                      : r.activity
                                        ? `_${r.activity}_`
                                        : "")
                                  }
                                  pending={r.status === "queued" || r.status === "streaming"}
                                  isError={r.status === "error"}
                                  timestamp={r.createdAt}
                                  onOpenUrl={onOpenUrl}
                                  showTimestamp={false}
                                />
                                {r.status === "done" && suggestions.length > 0 ? (
                                  <div className="cave-next-paths mt-1.5">
                                    {suggestions.map((s, i) => {
                                      // The agent lists next steps best-first, so
                                      // flag the top one as the recommendation.
                                      const recommended = i === 0;
                                      return (
                                        <button
                                          key={i}
                                          type="button"
                                          className={`cave-next-path${recommended ? " cave-next-path--recommended" : ""}`}
                                          onClick={() => void broadcast(s)}
                                          disabled={busy}
                                          aria-label={recommended ? `Recommended: ${s}` : undefined}
                                          title={recommended ? "Recommended next step" : undefined}
                                        >
                                          {s}
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="border-t px-4 py-3" style={{ borderColor: "var(--border-hairline)" }}>
              <div ref={composerRef} className="mx-auto flex max-w-3xl items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    syncMention();
                  }}
                  onKeyUp={syncMention}
                  onClick={syncMention}
                  onBlur={() => setMention(null)}
                  onKeyDown={(e) => {
                    if (mentionOpen) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setMentionIndex((i) => (i + 1) % mentionMatches.length);
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        chooseMention(mentionMatches[mentionIndex] ?? mentionMatches[0]);
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setMention(null);
                        return;
                      }
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  placeholder={
                    participants.length === 0
                      ? "Add familiars to this coven first…"
                      : `Message ${participants.length} familiar${participants.length === 1 ? "" : "s"}… (@ to tag one)`
                  }
                  disabled={participants.length === 0}
                  className="max-h-40 min-h-[40px] flex-1 resize-none rounded-lg border px-3 py-2 text-[14px] outline-none disabled:opacity-50"
                  style={{ borderColor: "var(--border-hairline)", background: "var(--bg-base)", color: "var(--text-primary)" }}
                />
                <Popover
                  open={mentionOpen}
                  onOpenChange={(next) => {
                    if (!next) setMention(null);
                  }}
                  anchorRef={composerRef}
                  placement="top-start"
                  ariaLabel="Tag a familiar"
                  minWidth={220}
                >
                  <div className="max-h-64 overflow-y-auto p-1">
                    {mentionMatches.map((f, i) => {
                      const resolved = byId.get(f.id);
                      return (
                        <button
                          key={f.id}
                          type="button"
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left"
                          style={i === mentionIndex ? { background: "var(--bg-raised)" } : undefined}
                          // Use mousedown so the textarea's onBlur doesn't fire first and close us.
                          onMouseDown={(e) => {
                            e.preventDefault();
                            chooseMention(f);
                          }}
                          onMouseEnter={() => setMentionIndex(i)}
                        >
                          {resolved && (
                            <FamiliarAvatar familiar={resolved} size="md" className="rounded-full object-cover" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px]" style={{ color: "var(--text-primary)" }}>
                              {f.name}
                            </div>
                            {resolved?.role && (
                              <div className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                                {resolved.role}
                              </div>
                            )}
                          </div>
                          <Icon name="ph:at" width={14} height={14} className="text-[var(--text-muted)]" />
                        </button>
                      );
                    })}
                  </div>
                </Popover>
                {busy ? (
                  <Button variant="danger-ghost" leadingIcon="ph:stop-fill" onClick={stop}>
                    Stop
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    leadingIcon="ph:arrow-up-bold"
                    disabled={participants.length === 0 || !draft.trim()}
                    onClick={() => void send()}
                  >
                    Send
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default GroupChatView;
