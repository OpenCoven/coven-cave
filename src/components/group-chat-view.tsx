"use client";

import "@/styles/cave-chat.css";
import "@/styles/cave-md.css";
import "@/styles/cave-composer.css";
import "@/styles/coven-tab.css";

/**
 * GroupChatView — the "coven" group-chat surface.
 *
 * A coven is a saved set of familiars you talk to together. Broadcast mode fans
 * a prompt out in parallel; Round robin mode rotates the lead and relays settled
 * peer replies before the next familiar takes its turn. Each familiar still has
 * its own resumable `/api/chat/send` session because there is no server-side
 * group-session primitive.
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
import { HarnessFixActions } from "@/components/harness-fix-actions";
import { parseHarnessFailure } from "@/lib/harness-failure";
import { defaultModelForRuntime } from "@/lib/runtime-models";
import { EmptyState } from "@/components/ui/empty-state";
import { Popover } from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/search-input";
import { SurfaceRail } from "@/components/ui/surface-rail";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAnnouncer } from "@/components/ui/live-region";
import { useStickToBottom } from "@/lib/use-stick-to-bottom";
import { MessageBubble } from "@/components/message-bubble";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { RelativeTime } from "@/components/ui/relative-time";
import { UserChatAvatar } from "@/components/user-chat-avatar";
import { Segmented } from "@/components/ui/settings-controls";
import { formatChatRecency, useDateTimePrefs } from "@/lib/datetime-format";
import { useUserProfile, userDisplayName } from "@/lib/user-profile";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  MAX_COVEN_DELEGATION_DEPTH,
  MAX_COVEN_DELEGATIONS_PER_TURN,
  applyGroupEvent,
  parseSseBuffer,
  defaultGroupName,
  makeGroup,
  upsertGroup,
  removeGroup,
  setGroupSession,
  setGroupParticipants,
  parseMentions,
  extractCovenDelegations,
  resolveGroupMessageTargets,
  mentionSuggestionAuthor,
  setGroupResponseMode,
  setGroupDetails,
  orderRoundRobinFamiliarIds,
  nextRoundRobinLeadId,
  renderCovenRoundtablePrompt,
  renderCovenRoundRobinPrompt,
  runCovenReplySchedule,
  COVEN_RESPONSE_MODES,
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
  type CovenResponseMode,
} from "@/lib/group-chat";
import { newId, nowIso } from "@/lib/group-chat-ids";
import { groupChatTranscriptThreads } from "@/lib/group-chat-transcript";

type Props = {
  familiars: ResolvedFamiliar[];
  /** Called whenever a participant's session is (re)created, so the host can
   *  refresh its session list and surface the new threads elsewhere. */
  onSessionStarted?: (sessionId: string) => void;
  onOpenUrl?: (url: string) => void;
};

export function GroupChatView({ familiars, onSessionStarted, onOpenUrl }: Props) {
  const profileSnapshot = useUserProfile();
  const operatorDisplayName = userDisplayName(profileSnapshot?.profile);
  const [groups, setGroups] = useState<CovenGroup[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<GroupTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // Rail search query + the Details drawer disclosure (session-local UI state).
  const [railQuery, setRailQuery] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  // @mention autocomplete in the composer.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  // Whether the transcript is scrolled to the bottom. When the reader has
  // scrolled up to review history, new streaming content must NOT yank them
  // back down — instead we surface a "jump to latest" pill.
  const [showJump, setShowJump] = useState(false);
  const dtPrefs = useDateTimePrefs();
  const confirm = useConfirm();
  const { announce } = useAnnouncer();

  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Intent-based follow (cave-o8si): scrolling up releases the stick, and only
  // returning to the true bottom re-attaches — the old 48px position threshold
  // re-stuck a reader pausing near the bottom, so the next streamed token
  // yanked them back down.
  const { stuckRef: stickToBottomRef, schedulePin, stick } = useStickToBottom(scrollRef, {
    onStickChange: (stuck) => {
      if (stuck) setShowJump(false);
    },
  });
  const composerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Caret to restore after we programmatically rewrite the draft (mention insert).
  const pendingCaretRef = useRef<number | null>(null);
  const groupsRef = useRef<CovenGroup[]>(groups);
  groupsRef.current = groups;
  // Live mirror of the transcript so retry can read the answered user turn
  // without re-creating its callback on every streaming token.
  const transcriptRef = useRef<GroupTurn[]>(transcript);
  transcriptRef.current = transcript;
  // Per-coven composer drafts: text typed for one coven must not silently
  // become a pending message to another on switch. Stashed by the swap
  // effect (in-memory only — a draft is not precious enough to persist).
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const draftsByGroupRef = useRef(new Map<string, string>());
  const draftOwnerRef = useRef<string | null>(null);
  // Which group the in-memory transcript belongs to (set by the swap effect).
  // The persist effect must not save until the swap has caught up, or the
  // previous coven's turns get written under the new coven's key.
  const transcriptOwnerRef = useRef<string | null>(null);
  // Throttled persistence: the newest un-persisted transcript, tagged with
  // its group id so a flush after a coven switch still targets the right key.
  const pendingSaveRef = useRef<{ groupId: string; turns: GroupTurn[] } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const flushPendingSave = useCallback(() => {
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (pending) saveTranscript(pending.groupId, pending.turns);
  }, []);

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
    // Switching covens abandons any in-flight broadcast on the previous one.
    // Abort it (otherwise its streams keep running and their tokens no-op
    // against the newly-loaded transcript — a leaked stream) and clear the
    // busy/abort state so the new coven starts clean. The previous coven keeps
    // its last-saved transcript; returning to it offers retry on any partial.
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    // Persist the outgoing coven's tail before swapping — the pending record
    // carries ITS group id, so this can never write under the new coven's key.
    flushPendingSave();
    transcriptOwnerRef.current = activeId;
    // Swap the composer draft along with the transcript: stash the outgoing
    // coven's draft and restore the incoming one's (or a clean slate).
    if (draftOwnerRef.current !== activeId) {
      if (draftOwnerRef.current) draftsByGroupRef.current.set(draftOwnerRef.current, draftRef.current);
      draftOwnerRef.current = activeId;
      setDraft(activeId ? draftsByGroupRef.current.get(activeId) ?? "" : "");
      setMention(null);
    }
    if (!activeId) {
      setTranscript([]);
      return;
    }
    setTranscript(loadTranscript(activeId));
  }, [activeId, flushPendingSave]);

  // --- persist transcript (throttled) --------------------------------------
  // Streaming produces a transcript state update per SSE token, from several
  // familiars concurrently; JSON.stringifying the whole transcript into
  // localStorage on each one is heavy synchronous main-thread work. Coalesce
  // to at most one write per interval, with the pending record flushed on
  // coven switch and unmount so no settled tail is lost. The owner guard
  // skips the stale commit right after a switch, where this effect still
  // sees the PREVIOUS coven's transcript against the new activeId (writing
  // it would clobber the new coven's stored transcript).
  useEffect(() => {
    if (!activeId || transcriptOwnerRef.current !== activeId) return;
    pendingSaveRef.current = { groupId: activeId, turns: transcript };
    if (saveTimerRef.current == null) {
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        flushPendingSave();
      }, 400);
    }
  }, [activeId, transcript, flushPendingSave]);
  useEffect(() => () => flushPendingSave(), [flushPendingSave]);

  // --- autoscroll to newest, but only when the reader is already at the bottom
  // Streaming replies grow the transcript constantly; force-scrolling on every
  // update would fight a reader who scrolled up to re-read an earlier answer.
  useEffect(() => {
    if (stickToBottomRef.current) {
      schedulePin();
      setShowJump(false);
    } else {
      // Something new landed while scrolled up — offer a jump affordance.
      setShowJump(true);
    }
  }, [transcript, schedulePin, stickToBottomRef]);

  // When the active group changes, snap to the bottom of its transcript.
  useEffect(() => {
    stick();
    setShowJump(false);
  }, [activeId, stick]);

  const jumpToLatest = useCallback(() => {
    stick();
    setShowJump(false);
  }, [stick]);

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

  // --- auto-grow the composer to fit its content (capped at max-height) -----
  // Covers typing, @mention inserts, and the collapse back to one row on send.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
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
      // A broadcast streams every familiar concurrently, so several session/done
      // events can land in the same tick. Reading the render-synced groupsRef
      // let each call rebase on the SAME stale groups, and the last write dropped
      // the others' session ids. Update functionally instead so every record
      // composes on the latest state; persist inside the updater. onSessionStarted
      // is fired unconditionally (idempotent list refresh) so a session is never
      // missed — we can't reliably read "did it change" back out of the updater.
      setGroups((prev) => {
        const current = prev.find((g) => g.id === groupId);
        if (!current || current.sessions[familiarId] === sessionId) return prev;
        const next = upsertGroup(prev, setGroupSession(current, familiarId, sessionId, nowIso()));
        saveGroups(next);
        return next;
      });
      onSessionStarted?.(sessionId);
    },
    [onSessionStarted],
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
      // Drop any throttled save queued for this coven — flushing it later
      // (e.g. on the switch below) would resurrect the just-deleted transcript.
      if (pendingSaveRef.current?.groupId === id) {
        pendingSaveRef.current = null;
        if (saveTimerRef.current != null) {
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
      }
      draftsByGroupRef.current.delete(id);
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

  // Deleting a coven drops its transcript irreversibly, so confirm first.
  const requestDeleteGroup = useCallback(
    async (id: string, name: string) => {
      const ok = await confirm({
        title: `Delete “${name || "this coven"}”?`,
        body: "This removes the coven and its transcript on this device. The familiars and their individual chats are untouched.",
        confirmLabel: "Delete coven",
        danger: true,
      });
      if (ok) deleteGroup(id);
    },
    [confirm, deleteGroup],
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

  // Details drawer: subject/summary commit on blur through the same
  // saveGroups path as every other group mutation. setGroupDetails returns
  // the identical object on a no-op commit, so an untouched blur neither
  // persists nor reorders the rail.
  const commitDetails = useCallback(
    (patch: { subject?: string; summary?: string }) => {
      const group = activeGroupRef.current;
      if (!group) return;
      const next = setGroupDetails(group, patch, nowIso());
      if (next === group) return;
      persistGroups(upsertGroup(groupsRef.current, next));
      announce("Coven details saved.");
    },
    [persistGroups, announce],
  );

  const changeResponseMode = useCallback(
    (responseMode: CovenResponseMode) => {
      const group = activeGroupRef.current;
      if (!group || busy || group.responseMode === responseMode) return;
      persistGroups(
        upsertGroup(groupsRef.current, setGroupResponseMode(group, responseMode, nowIso())),
      );
      announce(
        responseMode === "broadcast"
          ? "Broadcast mode. Familiars will respond at the same time."
          : "Round robin mode. Familiars will respond in turn and see earlier replies.",
      );
    },
    [announce, busy, persistGroups],
  );

  const advanceRoundRobinLead = useCallback((groupId: string, leadId: string) => {
    setGroups((prev) => {
      const current = prev.find((group) => group.id === groupId);
      if (!current) return prev;
      const nextLead = nextRoundRobinLeadId(current.familiarIds, leadId);
      if (current.nextRoundRobinLeadId === nextLead) return prev;
      const next = upsertGroup(prev, {
        ...current,
        nextRoundRobinLeadId: nextLead,
        updatedAt: nowIso(),
      });
      saveGroups(next);
      return next;
    });
  }, []);

  // --- mode-aware group send ----------------------------------------------
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
    async (rawText: string, explicitTargetFamiliarIds?: string[]) => {
      const group = activeGroupRef.current;
      const text = rawText.trim();
      if (!group || group.familiarIds.length === 0 || !text || busy || abortRef.current) return;
      // Suggestion chips carry their author's id explicitly. Visible mentions in
      // generated suggestion text must not widen that authoritative destination.
      // Composer messages still target their @mentions or the full coven.
      const mentionable: MentionableFamiliar[] = group.familiarIds.map((id) => ({
        id,
        name: byId.get(id)?.display_name ?? "",
      }));
      const { targetIds, targeted } = resolveGroupMessageTargets(
        text,
        group.familiarIds,
        mentionable,
        explicitTargetFamiliarIds,
      );
      // Historical replies remain in the transcript after roster edits. If their
      // author has left this coven, do not create a stranded user turn or unlock a
      // fallback broadcast by mistake.
      if (targetIds.length === 0) {
        announce("That familiar is no longer in this coven.", "assertive");
        return;
      }
      const orderedTargetIds = group.responseMode === "round-robin"
        ? orderRoundRobinFamiliarIds(group.familiarIds, targetIds, group.nextRoundRobinLeadId)
        : targetIds;
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
        { id: "__human__", name: operatorDisplayName, role: "", kind: "human" as const },
      ];
      const at = nowIso();
      const userTurn: GroupUserTurn = {
        id: newId(),
        role: "user",
        text,
        targetFamiliarIds: targeted ? targetIds : undefined,
        responseMode: group.responseMode,
        createdAt: at,
      };
      const replies: GroupReply[] = orderedTargetIds.map((fid, index) => ({
        id: newId(),
        role: "assistant",
        familiarId: fid,
        replyTo: userTurn.id,
        sessionId: group.sessions[fid] ?? null,
        text: "",
        status: "queued",
        activity:
          group.responseMode === "round-robin" && index > 0
            ? `Waiting for ${byId.get(orderedTargetIds[index - 1])?.display_name ?? orderedTargetIds[index - 1]}…`
            : undefined,
        createdAt: at,
      }));
      const priorTurns = transcriptRef.current;
      // The user just sent — snap them to the bottom regardless of prior scroll.
      stickToBottomRef.current = true;
      setShowJump(false);
      setTranscript((prev) => [...prev, userTurn, ...replies]);
      setDraft("");
      setMention(null);
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      if (group.responseMode === "round-robin" && replies.length > 1) {
        advanceRoundRobinLead(group.id, replies[0].familiarId);
      }
      const settled = await runCovenReplySchedule({
        mode: group.responseMode,
        replies,
        signal: controller.signal,
        onCancelled: (cancelled) => updateReply(cancelled.id, () => cancelled),
        runReply: (reply, settledBefore) => {
          const prompt = group.responseMode === "round-robin"
            ? renderCovenRoundRobinPrompt({
                participants: rosterParticipants,
                receivingFamiliarId: reply.familiarId,
                userText: text,
                targeted,
                familiarNames: mentionable,
                transcript: [...priorTurns, userTurn, ...settledBefore].map((turn) =>
                  turn.role === "assistant"
                    ? { ...turn, text: extractNextPaths(turn.text).visible }
                    : turn,
                ),
              })
            : renderCovenRoundtablePrompt({
                participants: rosterParticipants,
                receivingFamiliarId: reply.familiarId,
                userText: text,
                targeted,
              });
          return streamOne(group, reply, prompt, controller.signal);
        },
      });
      // A familiar can perform an explicit human-requested handoff by emitting
      // a validated delegation trailer. Plain assistant @mentions remain prose.
      // Process the small delegation tree sequentially so Stop prevents queued
      // work from starting and each target keeps its resumable familiar session.
      const delivered = new Set(
        transcriptRef.current
          .filter((turn): turn is GroupUserTurn => turn.role === "user" && Boolean(turn.delegationSourceReplyId))
          .map((turn) => `${turn.delegationSourceReplyId}:${turn.targetFamiliarIds?.[0] ?? ""}`),
      );
      let delegationCount = 0;
      const runDelegations = async (
        sourceReplies: GroupReply[],
        depth: number,
        lineage: Set<string>,
      ): Promise<void> => {
        if (depth >= MAX_COVEN_DELEGATION_DEPTH || controller.signal.aborted) return;
        for (const source of sourceReplies) {
          if (controller.signal.aborted || delegationCount >= MAX_COVEN_DELEGATIONS_PER_TURN) return;
          if (source.status !== "done") continue;
          const withoutNextPaths = extractNextPaths(source.text).visible;
          const { visible, delegations } = extractCovenDelegations(withoutNextPaths);
          const visibleTargets = new Set(parseMentions(visible, mentionable));
          for (const delegation of delegations) {
            if (controller.signal.aborted || delegationCount >= MAX_COVEN_DELEGATIONS_PER_TURN) return;
            const targetId = delegation.targetFamiliarId;
            const dedupeKey = `${source.id}:${targetId}`;
            if (
              targetId === source.familiarId ||
              !group.familiarIds.includes(targetId) ||
              !visibleTargets.has(targetId) ||
              !parseMentions(delegation.task, mentionable).includes(targetId) ||
              lineage.has(targetId) ||
              delivered.has(dedupeKey)
            ) continue;
            const target = byId.get(targetId);
            if (!target) continue;
            const at = nowIso();
            const delegatedTurn: GroupUserTurn = {
              id: newId(),
              role: "user",
              text: delegation.task,
              targetFamiliarIds: [targetId],
              delegatedByFamiliarId: source.familiarId,
              delegationSourceReplyId: source.id,
              delegationDepth: depth + 1,
              createdAt: at,
            };
            const delegatedReply: GroupReply = {
              id: newId(),
              role: "assistant",
              familiarId: targetId,
              replyTo: delegatedTurn.id,
              sessionId: groupsRef.current.find((item) => item.id === group.id)?.sessions[targetId] ?? null,
              text: "",
              status: "queued",
              createdAt: at,
            };
            delivered.add(dedupeKey);
            delegationCount += 1;
            setTranscript((prev) => [...prev, delegatedTurn, delegatedReply]);
            const delegatedBy = byId.get(source.familiarId)?.display_name ?? source.familiarId;
            const child = await streamOne(
              group,
              delegatedReply,
              renderCovenRoundtablePrompt({
                participants: rosterParticipants,
                receivingFamiliarId: targetId,
                userText: `Delegated by @${delegatedBy}:\n${delegation.task}`,
                targeted: true,
              }),
              controller.signal,
            );
            await runDelegations([child], depth + 1, new Set([...lineage, targetId]));
          }
        }
      };
      for (const source of settled) {
        await runDelegations([source], 0, new Set([source.familiarId]));
      }
      // Only clear the shared abort/busy wiring if this broadcast still owns it.
      // A coven switch (or a newer broadcast) may have replaced abortRef while
      // this one was aborting; clearing unconditionally would kill the newer
      // stream's Stop and unlock the composer mid-response.
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
      // The streaming bubbles are visual-only — announce the outcome for AT.
      const failed = settled.filter((r) => r.status === "error").length;
      const total = settled.length;
      if (failed === 0) {
        announce(`All ${total} familiar${total === 1 ? "" : "s"} replied.`);
      } else if (failed === total) {
        announce(`All ${total} ${total === 1 ? "reply" : "replies"} failed.`, "assertive");
      } else {
        announce(`${total - failed} of ${total} familiars replied; ${failed} failed.`, "assertive");
      }
    },
    [advanceRoundRobinLead, busy, streamOne, byId, announce, operatorDisplayName, updateReply],
  );

  // Composer sends and suggestion chips share the stream path, but a suggestion
  // is an explicitly targeted follow-up to the familiar that authored it.
  const send = useCallback(() => broadcast(draft), [broadcast, draft]);
  const sendSuggestion = useCallback(
    (suggestion: string, familiarId: string, displayName: string) =>
      broadcast(mentionSuggestionAuthor(suggestion, displayName), [familiarId]),
    [broadcast],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Re-run a single familiar's reply after a failure (or a cancel), reusing the
  // original user turn's text + targeting so the roundtable context is identical.
  const retryReply = useCallback(
    async (reply: GroupReply) => {
      const group = activeGroupRef.current;
      if (!group || busy || abortRef.current) return;
      const userTurn = transcriptRef.current.find(
        (t): t is GroupUserTurn => t.role === "user" && t.id === reply.replyTo,
      );
      if (!userTurn) return;
      const rosterParticipants: RosterParticipant[] = [
        ...group.familiarIds.map((id) => ({
          id,
          name: byId.get(id)?.display_name ?? id,
          role: byId.get(id)?.role ?? "",
          kind: "familiar" as const,
        })),
        { id: "__human__", name: operatorDisplayName, role: "", kind: "human" as const },
      ];
      // Reset the failed bubble in place so it re-enters the streaming state.
      const fresh: GroupReply = {
        ...reply,
        sessionId: group.sessions[reply.familiarId] ?? reply.sessionId ?? null,
        text: "",
        status: "queued",
        error: undefined,
        activity: undefined,
      };
      const delegator = userTurn.delegatedByFamiliarId
        ? byId.get(userTurn.delegatedByFamiliarId)?.display_name ?? userTurn.delegatedByFamiliarId
        : null;
      const retryText = delegator ? `Delegated by @${delegator}:\n${userTurn.text}` : userTurn.text;
      updateReply(reply.id, () => fresh);
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const settled = await streamOne(
        group,
        fresh,
        (userTurn.responseMode ?? "broadcast") === "round-robin"
          ? renderCovenRoundRobinPrompt({
              participants: rosterParticipants,
              receivingFamiliarId: fresh.familiarId,
              userText: retryText,
              targeted: Boolean(userTurn.targetFamiliarIds && userTurn.targetFamiliarIds.length > 0),
              familiarNames: group.familiarIds.map((id) => ({
                id,
                name: byId.get(id)?.display_name ?? id,
              })),
              transcript: transcriptRef.current
                .filter((turn) => turn.id !== reply.id)
                .map((turn) => turn.role === "assistant"
                  ? { ...turn, text: extractNextPaths(turn.text).visible }
                  : turn),
            })
          : renderCovenRoundtablePrompt({
              participants: rosterParticipants,
              receivingFamiliarId: fresh.familiarId,
              userText: retryText,
              targeted: Boolean(userTurn.targetFamiliarIds && userTurn.targetFamiliarIds.length > 0),
            }),
        controller.signal,
      );
      // Ownership-guarded (see broadcast): don't clobber a newer stream's wiring.
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
      const name = byId.get(fresh.familiarId)?.display_name ?? "Familiar";
      announce(
        settled.status === "error" ? `${name} failed again.` : `${name} replied.`,
        settled.status === "error" ? "assertive" : "polite",
      );
    },
    [busy, byId, updateReply, streamOne, announce, operatorDisplayName],
  );

  // Recovery for a harness/runtime failure on one reply: rebind that familiar
  // to the chosen adapter via /api/config, then re-run just their reply.
  const useHarnessForReply = useCallback(
    async (reply: GroupReply, runtime: string) => {
      if (busy) return;
      try {
        const res = await fetch("/api/config", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            familiars: { [reply.familiarId]: { harness: runtime, model: defaultModelForRuntime(runtime) } },
          }),
        });
        if (!res.ok) {
          announce(`Could not switch harness (${res.status}).`, "assertive");
          return;
        }
        window.dispatchEvent(new Event("cave:familiars-refresh"));
        await retryReply(reply);
      } catch {
        announce("Could not switch harness.", "assertive");
      }
    },
    [busy, retryReply, announce],
  );

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
  // Open whenever an @token is being typed (a no-match query shows the
  // "No matching familiar in this coven" empty state instead of vanishing);
  // key navigation below only engages while there are matches.
  const mentionOpen = mention !== null && mentionable.length > 0;

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
  // Single pass: this memo recomputes on every streaming token, so the old
  // users.map(… transcript.filter …) shape was O(userTurns × transcript).
  const threads = useMemo(() => {
    return groupChatTranscriptThreads(transcript);
  }, [transcript]);

  // Rail rows: "N familiars · last activity". Last activity prefers the
  // stored transcript's newest turn and falls back to the group's updatedAt.
  // Recomputed when the groups list changes (create/rename/roster/session
  // record), never per streaming token — the OPEN coven's recency instead
  // reads the live in-memory transcript at render.
  const lastActivityByGroup = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) {
      const turns = loadTranscript(g.id);
      m.set(g.id, turns[turns.length - 1]?.createdAt ?? g.updatedAt);
    }
    return m;
  }, [groups]);
  const liveLastTurnAt = transcript.length > 0 ? transcript[transcript.length - 1].createdAt : null;

  const railNeedle = railQuery.trim().toLowerCase();
  const filteredGroups = railNeedle
    ? groups.filter((g) => g.name.toLowerCase().includes(railNeedle))
    : groups;

  // Names for the "… replying" typing line — replies still in flight this turn.
  const replyingNames = useMemo(() => {
    if (!busy) return [];
    const names: string[] = [];
    for (const t of transcript) {
      if (t.role !== "assistant") continue;
      if (t.status !== "queued" && t.status !== "streaming") continue;
      const name = byId.get(t.familiarId)?.display_name ?? t.familiarId;
      if (!names.includes(name)) names.push(name);
    }
    return names;
  }, [busy, transcript, byId]);

  const participants = activeGroup
    ? activeGroup.familiarIds.map((id) => byId.get(id)).filter(Boolean as unknown as (f: ResolvedFamiliar | undefined) => f is ResolvedFamiliar)
    : [];
  const nextRoundRobinLead = activeGroup?.nextRoundRobinLeadId
    ? byId.get(activeGroup.nextRoundRobinLeadId) ?? null
    : participants[0] ?? null;

  // --- render --------------------------------------------------------------
  return (
    <div className="cave-group-chat-shell flex h-full min-h-0 w-full min-w-0 flex-1">
      {/* Coven list rail — the shared SurfaceRail (persisted width/collapse). */}
      <SurfaceRail
        storageKey="cave:coven:rail"
        title="Covens"
        ariaLabel="Covens"
        actions={
          <button
            type="button"
            className="coven-tab__rail-add focus-ring"
            title="New coven"
            aria-label="New coven"
            onClick={createGroup}
          >
            <Icon name="ph:plus-bold" width={15} aria-hidden />
          </button>
        }
        search={
          <SearchInput
            value={railQuery}
            onValueChange={setRailQuery}
            onClear={() => setRailQuery("")}
            placeholder="Search covens…"
            aria-label="Search covens"
          />
        }
      >
        {(open) => (
          <>
            {groups.length === 0 ? (
              <p className="px-2 py-3 text-[length:var(--text-sm)] leading-relaxed [color:var(--text-muted)]!">
                A coven is a group of familiars you talk to together. Create one to choose how they take turns responding.
              </p>
            ) : filteredGroups.length === 0 ? (
              <p className="px-2 py-1.5 text-[length:var(--text-sm)] [color:var(--text-muted)]!">
                No covens match &ldquo;{railQuery.trim()}&rdquo;.
              </p>
            ) : (
              <ul className="coven-tab__rail-list">
                {filteredGroups.map((g) => {
                  const memberCount = g.familiarIds.filter((id) => byId.has(id)).length;
                  const isActive = g.id === activeId;
                  const lastActivity =
                    (isActive && liveLastTurnAt) || lastActivityByGroup.get(g.id) || g.updatedAt;
                  return (
                    // Row = a real button (keyboard + roving focus). The delete
                    // control is a sibling overlay, not a nested button (which is
                    // invalid HTML and traps keyboard focus).
                    <li key={g.id} className="group/coven relative">
                      <button
                        type="button"
                        className="coven-tab__rail-row focus-ring"
                        aria-current={isActive ? "true" : undefined}
                        title={open ? undefined : g.name}
                        aria-label={open ? undefined : g.name}
                        onClick={() => setActiveId(g.id)}
                      >
                        <span className="coven-tab__rail-glyph" aria-hidden>
                          <Icon name="ph:users-three" width={13} height={13} />
                        </span>
                        {open ? (
                          <span className="coven-tab__rail-text">
                            <span className="coven-tab__rail-name" title={g.name}>
                              {g.name}
                            </span>
                            <span className="coven-tab__rail-meta">
                              {memberCount} familiar{memberCount === 1 ? "" : "s"} · <RelativeTime iso={lastActivity} />
                            </span>
                          </span>
                        ) : null}
                      </button>
                      {open ? (
                        <button
                          type="button"
                          className="focus-ring touch-always-visible absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover/coven:opacity-100"
                          title="Delete coven — removes this group chat only"
                          aria-label={`Delete ${g.name}`}
                          onClick={() => void requestDeleteGroup(g.id, g.name)}
                        >
                          <Icon name="ph:trash" width={14} height={14} />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </SurfaceRail>

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
            <header className="coven-tab__header">
              {renaming ? (
                <input
                  autoFocus
                  defaultValue={activeGroup.name}
                  aria-label="Coven name — Enter saves, Escape cancels"
                  className="coven-tab__title-input focus-ring-inset"
                  onBlur={(e) => {
                    renameGroup(e.target.value);
                    setRenaming(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(false);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="coven-tab__title focus-ring"
                  title="Double-click to rename"
                  aria-label={`Rename coven: ${activeGroup.name}`}
                  onDoubleClick={() => setRenaming(true)}
                  onKeyDown={(e) => {
                    // Pointer rename is double-click (per the handoff mock);
                    // keyboard rename stays single-keystroke on the button.
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setRenaming(true);
                    }
                  }}
                >
                  {activeGroup.name}
                </button>
              )}
              <div className="coven-tab__members">
                {participants.map((f) => (
                  <span key={f.id} className="coven-tab__member-chip">
                    <FamiliarAvatar familiar={f} size="sm" className="rounded-full object-cover" />
                    {f.display_name}
                  </span>
                ))}
                <button
                  ref={addBtnRef}
                  type="button"
                  className="coven-tab__add-member focus-ring"
                  aria-label="Add familiars to this coven"
                  aria-haspopup="dialog"
                  aria-expanded={pickerOpen}
                  onClick={() => setPickerOpen((v) => !v)}
                >
                  + Add
                </button>
              </div>
              <div className="coven-tab__mode">
                <fieldset disabled={busy} className="disabled:opacity-60">
                  <Segmented
                    options={COVEN_RESPONSE_MODES}
                    value={activeGroup.responseMode}
                    onChange={changeResponseMode}
                    getLabel={(mode) => mode === "broadcast" ? "Broadcast" : "Round robin"}
                    getTitle={(mode) =>
                      mode === "broadcast"
                        ? "Everyone responds at once"
                        : "One familiar at a time, in turn"
                    }
                    ariaLabel="Coven response mode"
                  />
                </fieldset>
                {/* The surface's status line: roster size + how it responds. */}
                <span className="coven-tab__status">
                  {participants.length} familiar{participants.length === 1 ? "" : "s"} ·{" "}
                  {activeGroup.responseMode === "broadcast"
                    ? "broadcast"
                    : `${nextRoundRobinLead?.display_name ?? "First familiar"} leads next`}
                </span>
              </div>
              <Popover
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                anchorRef={addBtnRef}
                placement="bottom-start"
                ariaLabel="Choose familiars"
                minWidth={240}
              >
                <div className="max-h-80 overflow-y-auto p-1">
                  {familiars.length === 0 ? (
                    <p className="px-2 py-2 text-[length:var(--text-sm)] [color:var(--text-muted)]!">
                      No familiars available.
                    </p>
                  ) : (
                    familiars.map((f) => {
                      const checked = activeGroup.familiarIds.includes(f.id);
                      return (
                        <button
                          key={f.id}
                          type="button"
                          className="focus-ring flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--bg-raised)]"
                          onClick={() => toggleParticipant(f.id)}
                        >
                          <FamiliarAvatar familiar={f} size="md" className="rounded-full object-cover" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[length:var(--text-base)] [color:var(--text-primary)]!">{f.display_name}</div>
                            <div className="truncate text-[length:var(--text-xs)] [color:var(--text-muted)]!">{f.role}</div>
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

            {/* Details drawer — subject + running summary, saved on blur. */}
            <button
              type="button"
              className="coven-tab__details-toggle focus-ring-inset"
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpen((v) => !v)}
            >
              <Icon name="ph:caret-right" width={11} height={11} className="coven-tab__details-chevron" aria-hidden />
              <span className="coven-tab__details-kicker">Details</span>
              <span className="coven-tab__details-preview">
                {activeGroup.subject || activeGroup.summary || "Add a subject and summary"}
              </span>
            </button>
            {detailsOpen ? (
              <div className="coven-tab__details">
                <label className="coven-tab__field">
                  <span className="coven-tab__field-label">Subject</span>
                  {/* key: re-seed the uncontrolled draft when the coven changes. */}
                  <input
                    key={`${activeGroup.id}:subject`}
                    type="text"
                    defaultValue={activeGroup.subject ?? ""}
                    placeholder="What is this coven about?"
                    className="coven-tab__field-input focus-ring-inset"
                    onBlur={(e) => commitDetails({ subject: e.target.value })}
                  />
                </label>
                <label className="coven-tab__field">
                  <span className="coven-tab__field-label">Summary</span>
                  <textarea
                    key={`${activeGroup.id}:summary`}
                    rows={2}
                    defaultValue={activeGroup.summary ?? ""}
                    placeholder="Short running summary of the conversation…"
                    className="coven-tab__field-input focus-ring-inset"
                    onBlur={(e) => commitDetails({ summary: e.target.value })}
                  />
                </label>
                <span className="coven-tab__details-meta">
                  Created <RelativeTime iso={activeGroup.createdAt} /> · updated{" "}
                  <RelativeTime iso={activeGroup.updatedAt} />
                </span>
              </div>
            ) : null}

            {/* Transcript */}
            <div className="relative min-h-0 flex-1">
            <div
              ref={scrollRef}
              role="log"
              aria-label="Coven transcript"
              aria-live="off"
              className="h-full overflow-y-auto px-6 py-5"
            >
              {threads.length === 0 ? (
                <div className="grid h-full place-items-center">
                  <EmptyState
                    icon="ph:chats-circle"
                    headline={participants.length === 0 ? "Add familiars to begin" : "Start the conversation"}
                    subtitle={
                      participants.length === 0
                        ? "A coven is a group chat — pick who's in it."
                        : activeGroup.responseMode === "broadcast"
                          ? "Every familiar responds at once in its own thread."
                          : "Familiars respond in turn and see earlier replies."
                    }
                    actions={
                      participants.length === 0 ? (
                        <Button variant="primary" leadingIcon="ph:plus-bold" onClick={() => setPickerOpen(true)}>
                          Add familiars
                        </Button>
                      ) : undefined
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
                    const delegator = user.delegatedByFamiliarId
                      ? byId.get(user.delegatedByFamiliarId)
                      : undefined;
                    return (
                    <div key={user.id} className="flex flex-col gap-2">
                      {targets && targets.length > 0 && (
                        <div className="flex items-center gap-1.5 self-end text-[length:var(--text-xs)] [color:var(--text-muted)]!">
                          <Icon name="ph:at" width={12} height={12} />
                          <span>
                            to {targets.map((f) => f.display_name).join(", ")}
                          </span>
                        </div>
                      )}
                      <div className="cave-group-chat-turn cave-group-chat-turn--user">
                        {delegator ? (
                          <div className="cave-group-chat-avatar">
                            <FamiliarAvatar familiar={delegator} size="xl" className="cave-group-chat-avatar__image" title={delegator.display_name} />
                          </div>
                        ) : (
                          <UserChatAvatar className="cave-group-chat-avatar cave-group-chat-avatar--human" />
                        )}
                        <div className="cave-group-chat-message">
                          <div className="cave-group-chat-meta">
                            <span className="cave-group-chat-name">{delegator?.display_name ?? operatorDisplayName}</span>
                            <span className={`cave-group-chat-badge${delegator ? "" : " cave-group-chat-badge--op"}`}>
                              {delegator ? "HANDOFF" : "OP"}
                            </span>
                            <time className="cave-group-chat-recency" dateTime={user.createdAt}>
                              {formatChatRecency(user.createdAt, dtPrefs)}
                            </time>
                          </div>
                          <MessageBubble role={delegator ? "assistant" : "user"} content={user.text} timestamp={user.createdAt} showTimestamp={false} onOpenUrl={onOpenUrl} />
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
                          const { visible: withoutNextPaths, suggestions } = extractNextPaths(r.text);
                          const { visible: visibleText } = extractCovenDelegations(withoutNextPaths);
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
                                {r.status === "error" ? (
                                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                    <Button
                                      size="xs"
                                      variant="secondary"
                                      leadingIcon="ph:arrow-clockwise"
                                      onClick={() => void retryReply(r)}
                                      disabled={busy}
                                    >
                                      Retry
                                    </Button>
                                    {(() => {
                                      const failure = parseHarnessFailure(r.error);
                                      return failure ? (
                                        <HarnessFixActions
                                          failure={failure}
                                          busy={busy}
                                          onUseHarness={(runtime) => void useHarnessForReply(r, runtime)}
                                        />
                                      ) : null;
                                    })()}
                                  </div>
                                ) : null}
                                {r.status === "done" && suggestions.length > 0 ? (
                                  <div className="cave-next-paths mt-1.5" data-count={suggestions.length}>
                                    {suggestions.map((s, i) => {
                                      // The agent lists next steps best-first, so
                                      // flag the top one as the recommendation.
                                      const recommended = i === 0;
                                      return (
                                        <button
                                          key={i}
                                          type="button"
                                          className={`cave-next-path${recommended ? " cave-next-path--recommended" : ""}`}
                                          onClick={() => void sendSuggestion(s, r.familiarId, f?.display_name ?? r.familiarId)}
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
                  {/* Typing line: who is still replying this turn (the bubbles
                      above carry the detailed queued/streaming affordances). */}
                  {replyingNames.length > 0 ? (
                    <div className="coven-tab__typing">
                      <span>{replyingNames.join(", ")} replying…</span>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
              {/* Jump-to-latest: shown when new replies land while the reader has
                  scrolled up. Clicking snaps back to the newest message. */}
              {showJump && (
                <button
                  type="button"
                  onClick={jumpToLatest}
                  className="focus-ring absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[length:var(--text-sm)] font-medium shadow-md [background:var(--bg-raised)]! [border-color:var(--border-hairline)]! [color:var(--text-primary)]!"
                >
                  <Icon name="ph:arrow-down" width={13} height={13} />
                  {busy ? "New replies" : "Jump to latest"}
                </button>
              )}
            </div>

            {/* Composer */}
            <div className="border-t px-5 py-3.5 [border-color:var(--border-hairline)]!">
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
                    // `isComposing` is true for the Enter/Tab that confirms an
                    // IME candidate (CJK input) — confirming a character must
                    // never pick a mention or broadcast the half-composed
                    // draft. Mirrors ChatView's composer guard.
                    if (e.nativeEvent.isComposing) return;
                    if (mentionOpen) {
                      if (e.key === "ArrowDown" && mentionMatches.length > 0) {
                        e.preventDefault();
                        setMentionIndex((i) => (i + 1) % mentionMatches.length);
                        return;
                      }
                      if (e.key === "ArrowUp" && mentionMatches.length > 0) {
                        e.preventDefault();
                        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
                        return;
                      }
                      if ((e.key === "Enter" || e.key === "Tab") && mentionMatches.length > 0) {
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
                  aria-label={activeGroup ? `Message the ${activeGroup.name} coven` : "Message the coven"}
                  placeholder={
                    participants.length === 0
                      ? "Add familiars to this coven first…"
                      : `Message ${participants.length} familiar${participants.length === 1 ? "" : "s"}… (@ to tag one)`
                  }
                  disabled={participants.length === 0}
                  className="max-h-40 min-h-[var(--space-10)] flex-1 resize-none rounded-lg border px-3 py-2 text-[length:var(--text-md)] outline-none disabled:opacity-50 [border-color:var(--border-hairline)]! [background:color-mix(in_oklch,var(--bg-raised)_70%,transparent)]! [color:var(--text-primary)]!"
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
                    <span className="coven-tab__mention-kicker">Tag a familiar</span>
                    {mentionMatches.length === 0 ? (
                      <p className="coven-tab__mention-empty">No matching familiar in this coven</p>
                    ) : null}
                    {mentionMatches.map((f, i) => {
                      const resolved = byId.get(f.id);
                      return (
                        <button
                          key={f.id}
                          type="button"
                          className="focus-ring flex w-full items-center gap-2 rounded px-2 py-1.5 text-left"
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
                            <div className="truncate text-[length:var(--text-base)] [color:var(--text-primary)]!">
                              {f.name}
                            </div>
                            {resolved?.role && (
                              <div className="truncate text-[length:var(--text-xs)] [color:var(--text-muted)]!">
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
                  <Button variant="secondary" className="coven-tab__stop" leadingIcon="ph:stop-fill" onClick={stop}>
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
