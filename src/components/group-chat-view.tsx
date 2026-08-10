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
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "@/lib/icon";
import { extractNextPaths } from "@/lib/next-paths";
import { createAttentionSafeTextAccumulator } from "@/lib/chat-attention-stream";
import { Button } from "@/components/ui/button";
import { ProjectPicker } from "@/components/project-picker";
import { modelForRuntimeSwitch } from "@/lib/runtime-models";
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
import { consumeCovenGroupPending } from "@/lib/chat-tab-events";
import { formatChatRecency, useDateTimePrefs } from "@/lib/datetime-format";
import { useUserProfile, userDisplayName } from "@/lib/user-profile";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  MAX_COVEN_DELEGATION_DEPTH,
  MAX_COVEN_DELEGATIONS_PER_TURN,
  applyGroupEvent,
  replaceGroupReplyText,
  parseSseBuffer,
  defaultGroupName,
  makeGroup,
  upsertGroup,
  removeGroup,
  setGroupSession,
  setGroupProject,
  setGroupParticipants,
  parseMentions,
  extractCovenDelegations,
  isCovenDelegationTaskVisible,
  resolveGroupMessageTargets,
  mentionSuggestionAuthor,
  setGroupResponseMode,
  setGroupDetails,
  setGroupParticipantIncluded,
  moveGroupParticipant,
  includedGroupParticipants,
  orderRoundRobinFamiliarIds,
  nextRoundRobinLeadId,
  renderCovenRoundtablePrompt,
  renderCovenRoundRobinPrompt,
  runCovenReplySchedule,
  findActiveMention,
  reconcileMentionCompletions,
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
  type MentionCompletion,
  type MentionableFamiliar,
  type RosterParticipant,
  type CovenResponseMode,
} from "@/lib/group-chat";
import { newId, nowIso } from "@/lib/group-chat-ids";
import { groupChatTranscriptThreads } from "@/lib/group-chat-transcript";
import {
  COVEN_RUN_STATUS,
  buildCovenRunFromThread,
  covenHistoryFold,
  covenRailStatus,
  covenRunPill,
  type CovenRun,
} from "@/lib/coven-run";
import { CovenHistoryFoldView } from "@/components/coven-history-fold";
import {
  COVEN_JUMP_TO_RUN_EVENT,
  publishCovenRunPill,
} from "@/lib/coven-run-signal";
import { covenComposerRouting } from "@/lib/coven-composer-routing";
import type { CovenStopScope } from "@/lib/coven-stop-scope";
import { CovenRunHeader } from "@/components/coven-run-header";
import { CovenAgentSection, type CovenSuggestion } from "@/components/coven-agent-section";
import { CovenComposerBar } from "@/components/coven-composer-bar";
import { CovenInspector } from "@/components/coven-inspector";
import { CovenRosterPopover, type CovenRosterEntry } from "@/components/coven-roster-popover";
import {
  listActiveGroupReplyRuns,
  newGroupReplyRunId,
  registerActiveGroupReplyRun,
  stopActiveGroupReplyRuns,
  unregisterActiveGroupReplyRun,
  updateActiveGroupReplyRunSession,
  type ActiveGroupReplyRun,
} from "@/lib/group-chat-stop";
import { useGroupProjects } from "@/lib/use-group-projects";

type Props = {
  familiars: ResolvedFamiliar[];
  /** Called whenever a participant's session is (re)created, so the host can
   *  refresh its session list and surface the new threads elsewhere. */
  onSessionStarted?: (sessionId: string) => void;
  onOpenUrl?: (url: string) => void;
  /** Opens a participant's pinned session as a regular conversation with the
   *  debug modal latched — the coven tab itself has no DebugPane host. */
  onDebugSession?: (sessionId: string, familiarId: string) => void;
};

function CovenMentionPills({
  familiars,
  emptyHint,
  align = "start",
  id,
}: {
  familiars: ResolvedFamiliar[];
  emptyHint?: string;
  align?: "start" | "end";
  id?: string;
}) {
  if (familiars.length === 0 && !emptyHint) return null;
  const names = familiars.map((f) => f.display_name);
  return (
    <div
      id={id}
      role="note"
      className={`coven-tab__mention-strip${align === "end" ? " coven-tab__mention-strip--end" : ""}`}
      aria-label={names.length > 0 ? `Tagged familiars: ${names.join(", ")}` : emptyHint}
    >
      <span className="coven-tab__mention-guidance">
        {names.length > 0 ? "Tagged" : emptyHint}
      </span>
      {familiars.map((f) => (
        <span key={f.id} className="coven-tab__mention-chip" aria-hidden="true">
          @{f.display_name}
        </span>
      ))}
    </div>
  );
}

const EMPTY_FAMILIAR_IDS: readonly string[] = [];

export function GroupChatView({ familiars, onSessionStarted, onOpenUrl, onDebugSession }: Props) {
  const profileSnapshot = useUserProfile();
  const operatorDisplayName = userDisplayName(profileSnapshot?.profile);
  const [groups, setGroups] = useState<CovenGroup[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<GroupTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // Rail search query + the details inspector disclosure (session-local UI state).
  const [railQuery, setRailQuery] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // Stepper focus: show one familiar's replies and hide (never stop) the rest.
  const [focusId, setFocusId] = useState<string | null>(null);
  // Pause holds the rotation between turns; `pausePending` is the window where
  // the request is in but the current reply is still finishing.
  const [paused, setPaused] = useState(false);
  const [pausePending, setPausePending] = useState(false);
  // A draft typed during a run: Enter queues rather than interrupting.
  const [queuedDraft, setQueuedDraft] = useState<string | null>(null);
  // Finished runs the reader has folded away to one summary line.
  const [collapsedRuns, setCollapsedRuns] = useState<ReadonlySet<string>>(() => new Set());
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
  const mentionGuidanceId = useId();

  const rosterBtnRef = useRef<HTMLButtonElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Pause plumbing for the round-robin turn gate. Refs, not state: the gate is
  // awaited inside a running schedule and must read the CURRENT decision, not
  // the value captured when the schedule started.
  const pauseRequestedRef = useRef(false);
  const pauseReleaseRef = useRef<(() => void) | null>(null);
  const stopAllRef = useRef(false);
  const activeRunsRef = useRef(new Map<string, ActiveGroupReplyRun>());
  const runScopeRef = useRef(0);
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
  // Picker-confirmed token spans stay complete while the user continues
  // ordinary prose. This is autocomplete state only; visible text remains
  // authoritative.
  const completedMentionsRef = useRef<MentionCompletion[]>([]);
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
  const completedMentionsByGroupRef = useRef(
    new Map<string, MentionCompletion[]>(),
  );
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
  const {
    projects: groupProjects,
    loading: groupProjectsLoading,
    error: groupProjectsError,
    loadedSuccessfully: groupProjectsLoadedSuccessfully,
  } = useGroupProjects(activeGroup?.familiarIds ?? EMPTY_FAMILIAR_IDS);
  const selectedGroupProject =
    groupProjects.find((project) => project.id === activeGroup?.projectId) ?? null;
  const projectLaunchReady =
    groupProjectsLoadedSuccessfully &&
    !groupProjectsLoading &&
    !groupProjectsError &&
    Boolean(selectedGroupProject);
  const projectLaunchMessage = groupProjectsLoading
    ? "Checking shared project access…"
    : groupProjectsError
      ? "Shared projects are unavailable. Retry before sending."
      : !groupProjectsLoadedSuccessfully
        ? "Checking shared project access…"
        : groupProjects.length === 0
          ? "No project is accessible to every familiar in this coven."
          : "Choose a project every familiar in this coven can access.";
  const activeGroupRef = useRef<CovenGroup | null>(activeGroup);
  activeGroupRef.current = activeGroup;

  // --- load persisted groups once -----------------------------------------
  useEffect(() => {
    const loaded = loadGroups();
    setGroups(loaded);
    // A chat promoted from the title row (cave-9xadi) names the coven it just
    // created. Honour that explicitly rather than leaning on the most-recently-
    // updated-first sort to put it at index 0 — the sort is a display order,
    // not a promise about which coven the user asked for.
    const requested = consumeCovenGroupPending();
    const target = requested && loaded.some((g) => g.id === requested) ? requested : loaded[0]?.id;
    if (target) setActiveId(target);
  }, []);

  // --- swap transcript when the active group changes ----------------------
  useEffect(() => {
    // Switching covens abandons any in-flight broadcast on the previous one.
    // Retire that scope before swapping so any late completion becomes inert
    // here, ask the server to stop its runs, and let the helper abort the local
    // stream once the stop dispatch settles.
    const retiringScopeId = runScopeRef.current;
    runScopeRef.current += 1;
    abortRef.current = null;
    setBusy(false);
    // Release any held rotation on the way out. A pause is an awaited promise
    // inside the retiring schedule; leaving it held would strand that schedule
    // forever, and the pause state would follow the reader into a coven that
    // has no run at all.
    stopAllRef.current = true;
    pauseRequestedRef.current = false;
    pauseReleaseRef.current?.();
    pauseReleaseRef.current = null;
    setPaused(false);
    setPausePending(false);
    setFocusId(null);
    setQueuedDraft(null);
    void stopScopeRuns(retiringScopeId, { quiet: false });
    // Persist the outgoing coven's tail before swapping — the pending record
    // carries ITS group id, so this can never write under the new coven's key.
    flushPendingSave();
    transcriptOwnerRef.current = activeId;
    // Swap the composer draft along with the transcript: stash the outgoing
    // coven's draft and restore the incoming one's (or a clean slate).
    if (draftOwnerRef.current !== activeId) {
      const outgoingGroupId = draftOwnerRef.current;
      if (outgoingGroupId) {
        draftsByGroupRef.current.set(outgoingGroupId, draftRef.current);
        const completions = completedMentionsRef.current;
        if (completions.length > 0) {
          completedMentionsByGroupRef.current.set(outgoingGroupId, completions);
        } else {
          completedMentionsByGroupRef.current.delete(outgoingGroupId);
        }
      }
      draftOwnerRef.current = activeId;
      const incomingDraft = activeId
        ? draftsByGroupRef.current.get(activeId) ?? ""
        : "";
      draftRef.current = incomingDraft;
      setDraft(incomingDraft);
      setMention(null);
      completedMentionsRef.current = activeId
        ? [...(completedMentionsByGroupRef.current.get(activeId) ?? [])]
        : [];
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
  useEffect(() => () => {
    flushPendingSave();
    const retiringScopeId = runScopeRef.current;
    runScopeRef.current += 1;
    void stopScopeRuns(retiringScopeId, { quiet: true });
  }, [flushPendingSave]);

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

  const changeGroupProject = useCallback(
    (projectId: string) => {
      const group = activeGroupRef.current;
      if (!group || busy) return;
      const next = setGroupProject(group, projectId, nowIso());
      if (next === group) return;
      persistGroups(upsertGroup(groupsRef.current, next));
      announce("Coven project changed. New participant sessions will start there.");
    },
    [announce, busy, persistGroups],
  );

  // A deleted project, revoked grant, or roster edit can invalidate the saved
  // intersection. Once the fresh participant scopes settle, clear both the
  // stale choice and its cwd-scoped session pins before another send.
  useEffect(() => {
    const group = activeGroupRef.current;
    if (!groupProjectsLoadedSuccessfully || !group?.projectId || selectedGroupProject) return;
    const next = setGroupProject(group, null, nowIso());
    persistGroups(upsertGroup(groupsRef.current, next));
    announce("Choose another project before sending to this coven.", "assertive");
  }, [
    announce,
    groupProjectsLoadedSuccessfully,
    persistGroups,
    selectedGroupProject,
  ]);

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
      completedMentionsByGroupRef.current.delete(id);
      if (draftOwnerRef.current === id) {
        draftOwnerRef.current = null;
        completedMentionsRef.current = [];
      }
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
      if (!group || group.responseMode === responseMode) return;
      persistGroups(
        upsertGroup(groupsRef.current, setGroupResponseMode(group, responseMode, nowIso())),
      );
      // Deliberately NOT blocked while a run is in flight. A run's ownership of
      // its mode is never ambiguous — the schedule captured its mode when it
      // started and each user turn snapshots its own — so switching mid-run can
      // only affect the next message, which is what the composer says it does.
      // Blocking the switch until Stop would punish planning ahead.
      announce(
        busy
          ? responseMode === "broadcast"
            ? "Broadcast mode for your next message. This run keeps its mode."
            : "Round robin mode for your next message. This run keeps its mode."
          : responseMode === "broadcast"
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

  async function stopServerRun(entry: { runId: string; sessionId: string | null }) {
    const response = await fetch("/api/chat/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: entry.runId,
        ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
      }),
    });
    let payload: { ok?: boolean; stopped?: boolean; error?: string } | null = null;
    try {
      payload = await response.json() as { ok?: boolean; stopped?: boolean; error?: string };
    } catch {
      payload = null;
    }
    return {
      ok: response.ok,
      stopped: payload?.stopped ?? false,
      status: response.status,
      error: payload?.error ?? (response.ok ? undefined : `stop failed (${response.status})`),
    };
  }

  async function stopScopeRuns(
    scopeId: number,
    { quiet }: { quiet: boolean } = { quiet: false },
  ) {
    const entries = listActiveGroupReplyRuns(activeRunsRef.current, scopeId);
    if (entries.length === 0) return [];
    let announced = false;
    return stopActiveGroupReplyRuns({
      entries,
      stopRun: stopServerRun,
      onError: (result, entry) => {
        console.warn("[group-chat] stop failed", {
          runId: result.runId,
          familiarId: entry.familiarId,
          status: result.status,
          error: result.error,
        });
        if (!quiet && !announced) {
          announced = true;
          announce("Some replies may keep running on the server.", "assertive");
        }
      },
    });
  }

  /**
   * Stop exactly one familiar's turn (design proposal §8, "Stop <name>").
   *
   * Scoped to that reply's server run, so a rotation continues to the next
   * familiar and a broadcast's other familiars are untouched. Whatever had
   * streamed is kept and labelled Stopped.
   */
  async function stopReplyRun(replyId: string) {
    const entries = listActiveGroupReplyRuns(activeRunsRef.current, runScopeRef.current).filter(
      (entry) => entry.replyId === replyId,
    );
    if (entries.length === 0) return;
    updateReply(replyId, (reply) => ({
      ...reply,
      status: "done",
      outcome: "stopped",
      activity: undefined,
      activityKind: undefined,
    }));
    await stopActiveGroupReplyRuns({
      entries,
      stopRun: stopServerRun,
      onError: (result, entry) => {
        console.warn("[group-chat] stop failed", {
          runId: result.runId,
          familiarId: entry.familiarId,
          status: result.status,
          error: result.error,
        });
        announce("That reply may keep running on the server.", "assertive");
      },
    });
  }

  /** Release a held rotation, whatever the reason it was held. */
  const releasePause = useCallback(() => {
    pauseRequestedRef.current = false;
    pauseReleaseRef.current?.();
    pauseReleaseRef.current = null;
    setPaused(false);
    setPausePending(false);
  }, []);

  /**
   * The round-robin turn gate: consulted between turns, so a pause holds the
   * queue without cancelling anything and Stop cannot then start the very turn
   * the pause was holding.
   */
  const turnGate = useCallback(async (): Promise<"run" | "stop"> => {
    if (stopAllRef.current) return "stop";
    if (pauseRequestedRef.current) {
      setPaused(true);
      setPausePending(false);
      await new Promise<void>((resolve) => {
        pauseReleaseRef.current = resolve;
      });
      setPaused(false);
    }
    return stopAllRef.current ? "stop" : "run";
  }, []);

  const handleStopScope = useCallback(
    (scope: CovenStopScope, currentReplyId: string | null) => {
      if (scope === "pause") {
        pauseRequestedRef.current = true;
        setPausePending(true);
        announce("Pausing after the current reply.");
        return;
      }
      if (scope === "current") {
        if (currentReplyId) void stopReplyRun(currentReplyId);
        return;
      }
      stopAllRef.current = true;
      // Release first: a held gate must wake up to see the stop rather than
      // stranding the run in a pause nothing can now resolve.
      releasePause();
      void stopScopeRuns(runScopeRef.current);
    },
    [announce, releasePause, stopScopeRuns],
  );

  // --- mode-aware group send ----------------------------------------------
  const streamOne = useCallback(
    async (
      group: CovenGroup,
      reply: GroupReply,
      prompt: string,
      projectRoot: string,
      scopeId: number,
      signal: AbortSignal,
    ): Promise<GroupReply> => {
      // `settled` mirrors the live React state so callers can await the final
      // reply state without waiting for React to render. Apply every update to both.
      let settled = reply;
      const replyRunId = newGroupReplyRunId();
      const attentionText = createAttentionSafeTextAccumulator();
      const apply = (fn: (r: GroupReply) => GroupReply) => {
        settled = fn(settled);
        if (scopeId !== runScopeRef.current) return;
        updateReply(reply.id, fn);
      };
      registerActiveGroupReplyRun(activeRunsRef.current, {
        runId: replyRunId,
        replyId: reply.id,
        groupId: group.id,
        familiarId: reply.familiarId,
        sessionId: reply.sessionId,
        scopeId,
        controller: abortRef.current ?? new AbortController(),
      });
      if (!projectRoot) {
        apply((current) =>
          applyGroupEvent(current, {
            kind: "error",
            message: "Choose a shared project before sending.",
          }),
        );
        return settled;
      }
      try {
        const res = await fetch("/api/chat/send", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            familiarId: reply.familiarId,
            prompt,
            sessionId: reply.sessionId,
            projectRoot,
            runId: replyRunId,
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
            if (ev.kind === "session") {
              updateActiveGroupReplyRunSession(activeRunsRef.current, replyRunId, ev.sessionId);
              if (scopeId === runScopeRef.current) recordSession(group.id, reply.familiarId, ev.sessionId);
            }
            if (ev.kind === "done" && ev.sessionId) {
              updateActiveGroupReplyRunSession(activeRunsRef.current, replyRunId, ev.sessionId);
              if (scopeId === runScopeRef.current) recordSession(group.id, reply.familiarId, ev.sessionId);
            }
            if (ev.kind === "assistant_chunk") {
              apply((r) => applyGroupEvent(r, {
                kind: "assistant_replace", text: attentionText.append(ev.text),
              }));
            } else if (ev.kind === "assistant_replace") {
              apply((r) => applyGroupEvent(r, {
                kind: "assistant_replace", text: attentionText.replace(ev.text),
              }));
            } else {
              apply((r) => applyGroupEvent(r, ev));
            }
          }
        }
        apply((r) => replaceGroupReplyText(r, attentionText.terminal()));
        // Stream closed without an explicit `done` — settle anything still live.
        apply((r) =>
          r.status === "streaming" || r.status === "queued" ? { ...r, status: "done", activity: undefined } : r,
        );
      } catch (err) {
        const aborted = (err as Error)?.name === "AbortError";
        apply((r) => replaceGroupReplyText(r, attentionText.terminal()));
        apply((r) =>
          aborted
            ? { ...r, status: "error", error: "cancelled", activity: undefined }
            : applyGroupEvent(r, { kind: "error", message: (err as Error)?.message ?? "send failed" }),
        );
      } finally {
        unregisterActiveGroupReplyRun(activeRunsRef.current, replyRunId);
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
      if (!projectLaunchReady || !selectedGroupProject) {
        announce(projectLaunchMessage, "assertive");
        return;
      }
      const projectRoot = selectedGroupProject.root;
      // Suggestion chips carry their author's id explicitly. Visible mentions in
      // generated suggestion text must not widen that authoritative destination.
      // Composer messages still target their @mentions or the full coven.
      const mentionable: MentionableFamiliar[] = group.familiarIds.map((id) => ({
        id,
        name: byId.get(id)?.display_name ?? "",
      }));
      // An untargeted message goes to the familiars included in the next run;
      // a sat-out familiar keeps its membership but does not receive it. An
      // @mention still reaches anyone in the coven — addressing someone
      // directly is the explicit override of their sit-out.
      const { targetIds, targeted } = resolveGroupMessageTargets(
        text,
        group.familiarIds,
        mentionable,
        explicitTargetFamiliarIds,
        includedGroupParticipants(group),
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
      draftRef.current = "";
      setDraft("");
      setMention(null);
      completedMentionsRef.current = [];
      setBusy(true);
      // A new run starts unpaused and unstopped: decisions belong to the run
      // they were made in, and a stale flag here would silently kill the next.
      pauseRequestedRef.current = false;
      pauseReleaseRef.current = null;
      stopAllRef.current = false;
      setPaused(false);
      setPausePending(false);
      setFocusId(null);
      runScopeRef.current += 1;
      const scopeId = runScopeRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      if (group.responseMode === "round-robin" && replies.length > 1) {
        advanceRoundRobinLead(group.id, replies[0].familiarId);
      }
      const settled = await runCovenReplySchedule({
        mode: group.responseMode,
        replies,
        signal: controller.signal,
        gate: turnGate,
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
          return streamOne(group, reply, prompt, projectRoot, scopeId, controller.signal);
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
              !isCovenDelegationTaskVisible(visible, delegation) ||
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
              projectRoot,
              scopeId,
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
        setPaused(false);
        setPausePending(false);
        pauseRequestedRef.current = false;
        pauseReleaseRef.current = null;
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
    [
      advanceRoundRobinLead,
      busy,
      streamOne,
      byId,
      announce,
      operatorDisplayName,
      projectLaunchMessage,
      projectLaunchReady,
      selectedGroupProject,
      turnGate,
      updateReply,
    ],
  );

  /**
   * Enter during a run **queues** — the safe default. Interrupting is only ever
   * explicit, via Stop (design proposal §7). The held draft sends itself once
   * the run settles, so the message the user pressed Enter on is never lost.
   */
  const send = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    if (busy) {
      setQueuedDraft(text);
      draftRef.current = "";
      setDraft("");
      setMention(null);
      completedMentionsRef.current = [];
      announce("Queued — sends when this run finishes.");
      return;
    }
    void broadcast(text);
  }, [announce, broadcast, busy, draft]);

  // Release the queued draft the moment the run that held it finishes.
  useEffect(() => {
    if (busy || !queuedDraft) return;
    const pending = queuedDraft;
    setQueuedDraft(null);
    void broadcast(pending);
  }, [broadcast, busy, queuedDraft]);

  // Composer sends and suggestion chips share the stream path, but a suggestion
  // is an explicitly targeted follow-up to the familiar that authored it.
  const sendSuggestion = useCallback(
    (suggestion: string, familiarId: string, displayName: string) =>
      broadcast(mentionSuggestionAuthor(suggestion, displayName), [familiarId]),
    [broadcast],
  );

  // Re-run a single familiar's reply after a failure (or a cancel), reusing the
  // original user turn's text + targeting so the roundtable context is identical.
  const retryReply = useCallback(
    async (reply: GroupReply) => {
      const group = activeGroupRef.current;
      if (!group || busy || abortRef.current) return;
      if (!projectLaunchReady || !selectedGroupProject) {
        announce(projectLaunchMessage, "assertive");
        return;
      }
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
      runScopeRef.current += 1;
      const scopeId = runScopeRef.current;
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
        selectedGroupProject.root,
        scopeId,
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
    [
      busy,
      byId,
      updateReply,
      streamOne,
      announce,
      operatorDisplayName,
      projectLaunchMessage,
      projectLaunchReady,
      selectedGroupProject,
    ],
  );

  // Recovery for a harness/runtime failure on one reply: before a session is
  // pinned, rebind that familiar via /api/config, then re-run just their reply.
  const useHarnessForReply = useCallback(
    async (reply: GroupReply, runtime: string) => {
      if (busy) return;
      if (reply.sessionId || activeGroupRef.current?.sessions[reply.familiarId]) {
        announce(
          "This reply is pinned to its original runtime. Start a new coven turn to use another runtime.",
          "assertive",
        );
        return;
      }
      try {
        const res = await fetch("/api/config", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            familiars: {
              [reply.familiarId]: {
                harness: runtime,
                model: modelForRuntimeSwitch(runtime),
              },
            },
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
  const composerTargets = useMemo(
    () =>
      parseMentions(draft, mentionable)
        .map((id) => byId.get(id))
        .filter((f): f is ResolvedFamiliar => Boolean(f)),
    [draft, mentionable, byId],
  );
  // Open whenever an @token is being typed (a no-match query shows the
  // "No matching familiar in this coven" empty state instead of vanishing);
  // key navigation below only engages while there are matches.
  const mentionOpen = mention !== null && mentionable.length > 0;

  // Recompute the active mention token from the textarea's current caret.
  const syncMention = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? el.value.length;
    const next = findActiveMention(
      el.value,
      caret,
      completedMentionsRef.current,
    );
    setMention(next);
    setMentionIndex(0);
  }, []);

  const chooseMention = useCallback(
    (f: MentionableFamiliar) => {
      if (!mention) return;
      const { text, caret, completion } = applyMention(
        draft,
        mention.start,
        mention.query,
        f.name,
      );
      completedMentionsRef.current = [
        ...reconcileMentionCompletions(
          draftRef.current,
          text,
          completedMentionsRef.current,
        ),
        completion,
      ].sort((a, b) => a.start - b.start);
      draftRef.current = text;
      pendingCaretRef.current = caret;
      setDraft(text);
      setMention(null);
      announce(`Tagged ${f.name}.`);
    },
    [mention, draft, announce],
  );

  // --- roster edits (design proposal §9) -----------------------------------
  // All three apply to the NEXT run; none of them touch a run in progress.
  const toggleParticipantIncluded = useCallback(
    (familiarId: string, included: boolean) => {
      const group = activeGroupRef.current;
      if (!group) return;
      const next = setGroupParticipantIncluded(group, familiarId, included, nowIso());
      if (next === group) return;
      persistGroups(upsertGroup(groupsRef.current, next));
      const name = byId.get(familiarId)?.display_name ?? familiarId;
      announce(included ? `${name} joins the next run.` : `${name} sits out the next run.`);
    },
    [announce, byId, persistGroups],
  );

  const moveParticipant = useCallback(
    (familiarId: string, delta: -1 | 1) => {
      const group = activeGroupRef.current;
      if (!group) return;
      const next = moveGroupParticipant(group, familiarId, delta, nowIso());
      if (next === group) return;
      persistGroups(upsertGroup(groupsRef.current, next));
      const name = byId.get(familiarId)?.display_name ?? familiarId;
      announce(`${name} moved ${delta < 0 ? "earlier" : "later"} in the rotation.`);
    },
    [announce, byId, persistGroups],
  );

  // --- derived transcript view --------------------------------------------
  // Group replies under the user turn they answer, then widen each group into a
  // run: mode, per-familiar run status, progress and (once settled) a summary.
  // Single pass: this memo recomputes on every streaming token, so the old
  // users.map(… transcript.filter …) shape was O(userTurns × transcript).
  const runs = useMemo<CovenRun[]>(() => {
    const fallbackMode = activeGroup?.responseMode ?? "broadcast";
    return groupChatTranscriptThreads(transcript).map((thread) =>
      buildCovenRunFromThread(thread, { fallbackMode }),
    );
  }, [transcript, activeGroup?.responseMode]);
  const activeRun = useMemo(() => runs.find((run) => run.active) ?? null, [runs]);

  // Earlier runs fold above the transcript (design proposal §6) so scrolling
  // back through yesterday's work is a choice rather than the default. Derived
  // from the runs already built — no second pass over the transcript.
  const historyFold = useMemo(
    () => covenHistoryFold(runs, { now: Date.now() }),
    [runs],
  );
  // Only the runs the fold does NOT stand for are rendered in full.
  const visibleRuns = useMemo(
    () => (historyFold ? runs.slice(historyFold.count) : runs),
    [runs, historyFold],
  );

  // Publish the run to the status bar's pill (design proposal §11), so run
  // state survives scrolling deep into history. Cleared on unmount and on
  // coven switch by the effect below — a pill that outlives its surface would
  // keep claiming a run is live after the reader has navigated away.
  // The LATEST run, not just a live one: `covenRunPill` reports a settled run's
  // summary and final duration, and §11 asks the bar to keep that last word
  // ("● Run complete"). Publishing only `activeRun` made the pill vanish the
  // instant a run finished, which left that whole branch unreachable.
  const pillRun = activeRun ?? runs[runs.length - 1] ?? null;
  useEffect(() => {
    publishCovenRunPill(covenRunPill({ run: pillRun, paused }));
  }, [pillRun, paused]);
  useEffect(() => () => publishCovenRunPill(null), []);
  useEffect(() => {
    if (!activeId) publishCovenRunPill(null);
  }, [activeId]);

  // The pill is a jump-off as well as a readout: clicking it lands here.
  useEffect(() => {
    const jump = () => {
      stick();
      setShowJump(false);
    };
    window.addEventListener(COVEN_JUMP_TO_RUN_EVENT, jump);
    return () => window.removeEventListener(COVEN_JUMP_TO_RUN_EVENT, jump);
  }, [stick]);

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

  const participants = activeGroup
    ? activeGroup.familiarIds.map((id) => byId.get(id)).filter(Boolean as unknown as (f: ResolvedFamiliar | undefined) => f is ResolvedFamiliar)
    : [];
  const includedIds = activeGroup ? includedGroupParticipants(activeGroup) : [];
  const includedParticipants = includedIds
    .map((id) => byId.get(id))
    .filter((f): f is ResolvedFamiliar => Boolean(f));
  const availableFamiliars = activeGroup
    ? familiars.filter((f) => !activeGroup.familiarIds.includes(f.id))
    : [];
  const rosterEntries: CovenRosterEntry[] = participants.map((familiar, index) => ({
    familiar,
    position: index + 1,
    included: includedIds.includes(familiar.id),
  }));

  // The composer states what Enter does right now, derived from the same
  // inputs the send path uses so the two cannot disagree.
  const routing = covenComposerRouting({
    mode: activeGroup?.responseMode ?? "broadcast",
    members: includedParticipants.map((f) => ({ id: f.id, name: f.display_name })),
    mentioned: composerTargets.map((f) => ({ id: f.id, name: f.display_name })),
    running: busy,
  });

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
                  // One status line, never a dashboard (design proposal §11).
                  // Only the open coven has a live run to report; the others
                  // fall back to their roster size and last activity.
                  const railStatus = isActive
                    ? covenRailStatus({ memberCount, run: activeRun, paused })
                    : null;
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
                            <span
                              className="coven-tab__rail-meta"
                              data-tone={railStatus?.tone ?? "muted"}
                              data-live={railStatus?.live ? "true" : "false"}
                            >
                              {railStatus?.icon ? (
                                <Icon
                                  name={railStatus.icon}
                                  width={10}
                                  height={10}
                                  className="coven-tab__rail-status-glyph"
                                  aria-hidden
                                />
                              ) : null}
                              {railStatus ? (
                                railStatus.text
                              ) : (
                                <>
                                  {memberCount} familiar{memberCount === 1 ? "" : "s"} ·{" "}
                                  <RelativeTime iso={lastActivity} />
                                </>
                              )}
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
              {/* Avatar stack + roster popover: identity, not a control panel.
                  Subject, summary, threads and access moved to the inspector so
                  the transcript never pays for them (design proposal §2). */}
              <div className="coven-tab__avatars">
                {participants.map((f) => (
                  <span
                    key={f.id}
                    className="coven-tab__avatar"
                    data-included={includedIds.includes(f.id) ? "true" : "false"}
                    title={`${f.display_name} — ${f.role}${includedIds.includes(f.id) ? "" : " · sitting out the next run"}`}
                  >
                    <FamiliarAvatar familiar={f} size="sm" />
                  </span>
                ))}
              </div>
              <button
                ref={rosterBtnRef}
                type="button"
                className="coven-tab__roster-trigger focus-ring"
                aria-haspopup="dialog"
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen((v) => !v)}
              >
                {participants.length} familiar{participants.length === 1 ? "" : "s"}
                {includedIds.length !== participants.length ? (
                  <span className="coven-tab__roster-sitting">
                    {participants.length - includedIds.length} out
                  </span>
                ) : null}
                <Icon name="ph:caret-down" width={10} height={10} aria-hidden />
              </button>
              <Popover
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                anchorRef={rosterBtnRef}
                placement="bottom-start"
                ariaLabel="Coven roster"
                minWidth={320}
              >
                <CovenRosterPopover
                  entries={rosterEntries}
                  available={availableFamiliars}
                  roundRobin={activeGroup.responseMode === "round-robin"}
                  running={busy}
                  onToggleIncluded={toggleParticipantIncluded}
                  onMove={moveParticipant}
                  onAdd={toggleParticipant}
                  onRemove={toggleParticipant}
                />
              </Popover>

              <span className="coven-tab__header-spacer" />

              <ProjectPicker
                projects={groupProjects}
                value={activeGroup.projectId ?? null}
                onChange={changeGroupProject}
                defaultToFirst={false}
                disabled={
                  busy ||
                  participants.length === 0 ||
                  groupProjectsLoading ||
                  Boolean(groupProjectsError)
                }
                ariaLabel="Project for this coven"
                className="max-w-52"
              />
              <button
                type="button"
                className="coven-tab__inspector-toggle focus-ring"
                aria-label="Conversation details"
                aria-pressed={inspectorOpen}
                title="Conversation details"
                onClick={() => setInspectorOpen((v) => !v)}
              >
                <Icon name="ph:sidebar-simple" width={14} height={14} aria-hidden />
              </button>
            </header>

            {/* Transcript + details inspector */}
            <div className="coven-tab__body">
              <div className="coven-tab__stream">
                <div className="relative min-h-0 flex-1">
                  <div
                    ref={scrollRef}
                    role="log"
                    aria-label="Coven transcript"
                    aria-live="off"
                    className="coven-tab__scroll"
                  >
                    {runs.length === 0 ? (
                      <div className="grid h-full place-items-center">
                        <EmptyState
                          icon="ph:chats-circle"
                          headline={participants.length === 0 ? "Add familiars to begin" : "Start the conversation"}
                          subtitle={
                            participants.length === 0
                              ? "A coven is a group chat — pick who's in it. Response modes appear once two or more familiars join."
                              : !projectLaunchReady
                                ? projectLaunchMessage
                                : activeGroup.responseMode === "broadcast"
                                  ? "Every familiar answers at once, independently, in its own thread."
                                  : "Familiars respond in turn and see earlier replies. @name routes to one without advancing the rotation."
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
                      <div className="coven-tab__runs">
                        {historyFold ? (
                          <CovenHistoryFoldView
                            fold={historyFold}
                            byId={byId}
                            formatTime={(iso) => formatChatRecency(iso, dtPrefs)}
                          />
                        ) : null}
                        {visibleRuns.map((run) => {
                          const targets = run.user.targetFamiliarIds
                            ?.map((id) => byId.get(id))
                            .filter((f): f is ResolvedFamiliar => Boolean(f));
                          const delegator = run.user.delegatedByFamiliarId
                            ? byId.get(run.user.delegatedByFamiliarId)
                            : undefined;
                          const collapsed = collapsedRuns.has(run.id);
                          // While one familiar is live, settled replies soft-clamp
                          // so the turn in progress owns the viewport (§4).
                          const someoneLive = run.agents.some(
                            (agent) => COVEN_RUN_STATUS[agent.status].live,
                          );
                          const currentAgent = run.agents.find(
                            (agent) => COVEN_RUN_STATUS[agent.status].live,
                          );
                          return (
                            <article key={run.id} className="coven-run">
                              <div className="cave-group-chat-turn cave-group-chat-turn--user">
                                {delegator ? (
                                  <div className="cave-group-chat-avatar">
                                    <FamiliarAvatar
                                      familiar={delegator}
                                      size="xl"
                                      className="cave-group-chat-avatar__image"
                                      title={delegator.display_name}
                                    />
                                  </div>
                                ) : (
                                  <UserChatAvatar className="cave-group-chat-avatar cave-group-chat-avatar--human" />
                                )}
                                <div className="cave-group-chat-message">
                                  <div className="cave-group-chat-meta">
                                    <span className="cave-group-chat-name">
                                      {delegator?.display_name ?? operatorDisplayName}
                                    </span>
                                    <span
                                      className={`cave-group-chat-badge${delegator ? "" : " cave-group-chat-badge--op"}`}
                                    >
                                      {delegator ? "HANDOFF" : "OP"}
                                    </span>
                                    <time className="cave-group-chat-recency" dateTime={run.user.createdAt}>
                                      {formatChatRecency(run.user.createdAt, dtPrefs)}
                                    </time>
                                  </div>
                                  <MessageBubble
                                    role={delegator ? "assistant" : "user"}
                                    content={run.user.text}
                                    timestamp={run.user.createdAt}
                                    showTimestamp={false}
                                    onOpenUrl={onOpenUrl}
                                  />
                                  <CovenMentionPills familiars={targets ?? []} align="end" />
                                </div>
                              </div>

                              {run.agents.length === 0 ? null : collapsed && run.summary ? (
                                <button
                                  type="button"
                                  className="coven-run__collapsed focus-ring"
                                  title="Expand this run"
                                  onClick={() =>
                                    setCollapsedRuns((prev) => {
                                      const next = new Set(prev);
                                      next.delete(run.id);
                                      return next;
                                    })
                                  }
                                >
                                  <Icon
                                    name={run.summary.icon}
                                    width={12}
                                    height={12}
                                    data-tone={run.summary.tone}
                                    aria-hidden
                                  />
                                  <span className="coven-run__collapsed-title">{run.summary.title}</span>
                                  <span className="coven-run__collapsed-meta">{run.summary.meta}</span>
                                  <span className="coven-run__collapsed-expand">Expand</span>
                                </button>
                              ) : (
                                <div className="coven-run__block">
                                  <CovenRunHeader
                                    run={run}
                                    byId={byId}
                                    focusId={focusId}
                                    onFocus={setFocusId}
                                    paused={paused && run.active}
                                    pausePending={pausePending && run.active}
                                    onPause={() => handleStopScope("pause", null)}
                                    onResume={releasePause}
                                    onStop={(scope) =>
                                      handleStopScope(scope, currentAgent?.reply.id ?? null)
                                    }
                                  />

                                  {run.active && paused ? (
                                    <div className="coven-run__banner" data-tone="warning" role="status">
                                      <Icon name="ph:pause-fill" width={12} height={12} aria-hidden />
                                      <span>
                                        Paused —{" "}
                                        {run.agents.find((agent) => agent.status === "queued")
                                          ? `${byId.get(run.agents.find((agent) => agent.status === "queued")!.familiarId)?.display_name ?? "the next familiar"} holds until you resume.`
                                          : "the queue holds until you resume."}{" "}
                                        Completed replies are kept.
                                      </span>
                                      <button
                                        type="button"
                                        className="coven-run__banner-action focus-ring"
                                        onClick={releasePause}
                                      >
                                        Resume
                                      </button>
                                    </div>
                                  ) : null}

                                  {focusId ? (
                                    <div className="coven-run__banner" data-tone="muted">
                                      <Icon name="ph:magnifying-glass" width={12} height={12} aria-hidden />
                                      <span>
                                        Focused on {byId.get(focusId)?.display_name ?? focusId} — other
                                        replies are hidden, not stopped.
                                      </span>
                                      <button
                                        type="button"
                                        className="coven-run__banner-action focus-ring"
                                        onClick={() => setFocusId(null)}
                                      >
                                        Show all
                                      </button>
                                    </div>
                                  ) : null}

                                  <div className="coven-run__sections">
                                    {run.started.map((agent) => {
                                      const familiar = byId.get(agent.familiarId);
                                      // Strip control markup in the same order as
                                      // the single-chat surface, so no partial tag
                                      // ever flashes as prose.
                                      const { visible: withoutNextPaths, suggestions: typed } =
                                        extractNextPaths(agent.reply.text);
                                      const { visible: visibleText } =
                                        extractCovenDelegations(withoutNextPaths);
                                      const replyTargets = parseMentions(visibleText, mentionable)
                                        .map((id) => byId.get(id))
                                        .filter((f): f is ResolvedFamiliar => Boolean(f));
                                      // Group chat has no task or action router: a
                                      // click here sends an ordinary message, never
                                      // a side effect, so only replies are offered.
                                      const suggestions: CovenSuggestion[] =
                                        agent.status === "complete"
                                          ? typed
                                              .filter((path) => path.kind === "reply")
                                              .map((path) => ({
                                                path,
                                                onSelect: () =>
                                                  void sendSuggestion(
                                                    path.prompt,
                                                    agent.familiarId,
                                                    familiar?.display_name ?? agent.familiarId,
                                                  ),
                                              }))
                                          : [];
                                      return (
                                        <CovenAgentSection
                                          key={agent.reply.id}
                                          agent={agent}
                                          familiar={familiar}
                                          timestamp={formatChatRecency(agent.reply.createdAt, dtPrefs)}
                                          hidden={focusId !== null && focusId !== agent.familiarId}
                                          clampable={someoneLive && run.active}
                                          showStop={COVEN_RUN_STATUS[agent.status].live}
                                          onStop={() => void stopReplyRun(agent.reply.id)}
                                          onRetry={() => void retryReply(agent.reply)}
                                          onSkip={null}
                                          onUseHarness={(runtime) =>
                                            void useHarnessForReply(agent.reply, runtime)
                                          }
                                          busy={busy}
                                          visibleText={
                                            visibleText ||
                                            (agent.status === "failed" ? "" : agent.reply.activity ?? "")
                                          }
                                          suggestions={suggestions}
                                          mentionPills={<CovenMentionPills familiars={replyTargets} />}
                                          onOpenUrl={onOpenUrl}
                                        />
                                      );
                                    })}
                                  </div>

                                  {run.summary ? (
                                    <div className="coven-run__summary" data-tone={run.summary.tone}>
                                      <Icon name={run.summary.icon} width={13} height={13} aria-hidden />
                                      <span className="coven-run__summary-title">{run.summary.title}</span>
                                      <span className="coven-run__summary-meta">{run.summary.meta}</span>
                                      <button
                                        type="button"
                                        className="coven-run__summary-action focus-ring"
                                        onClick={() =>
                                          setCollapsedRuns((prev) => new Set(prev).add(run.id))
                                        }
                                      >
                                        Collapse run
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {/* Jump-to-latest: shown when new replies land while the reader
                      has scrolled up. Clicking snaps back to the newest message. */}
                  {showJump && (
                    <button type="button" onClick={jumpToLatest} className="coven-jump focus-ring">
                      <Icon name="ph:arrow-down" width={13} height={13} aria-hidden />
                      {busy ? "New replies" : "Jump to latest"}
                    </button>
                  )}
                </div>

                {/* Composer */}
                <div className="coven-composer">
                  <div className="coven-composer__inner">
                    {participants.length > 0 && !projectLaunchReady ? (
                      <p
                        role={groupProjectsError ? "alert" : "status"}
                        className="coven-composer__gate"
                      >
                        {projectLaunchMessage}
                      </p>
                    ) : null}

                    <CovenComposerBar
                      routing={routing}
                      mode={activeGroup.responseMode}
                      onModeChange={changeResponseMode}
                      modeLocked={busy}
                      byId={byId}
                      queued={queuedDraft}
                      onDiscardQueued={() => setQueuedDraft(null)}
                    />

                    <div ref={composerRef} className="coven-composer__row">
                      <textarea
                        ref={textareaRef}
                        value={draft}
                        onChange={(e) => {
                          const nextDraft = e.target.value;
                          completedMentionsRef.current = reconcileMentionCompletions(
                            draftRef.current,
                            nextDraft,
                            completedMentionsRef.current,
                          );
                          draftRef.current = nextDraft;
                          setDraft(nextDraft);
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
                              setMentionIndex(
                                (i) => (i - 1 + mentionMatches.length) % mentionMatches.length,
                              );
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
                            send();
                          }
                        }}
                        rows={1}
                        aria-label={`Message the ${activeGroup.name} coven`}
                        aria-describedby={mentionGuidanceId}
                        placeholder={
                          !projectLaunchReady && participants.length > 0
                            ? "Choose a shared project above…"
                            : routing.placeholder
                        }
                        disabled={participants.length === 0}
                        className="coven-composer__field"
                      />
                      <Button
                        variant="primary"
                        leadingIcon={routing.queues ? "ph:clock" : "ph:arrow-up-bold"}
                        disabled={
                          participants.length === 0 || !draft.trim() || !projectLaunchReady
                        }
                        title={routing.sendTitle}
                        onClick={send}
                      >
                        {routing.sendLabel}
                      </Button>
                    </div>

                    {/* Always states what Enter does right now. */}
                    <p id={mentionGuidanceId} className="coven-composer__note">
                      {routing.enterNote}
                    </p>
                  </div>

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
                            data-active={i === mentionIndex ? "true" : "false"}
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
                </div>
              </div>

              {inspectorOpen ? (
                <CovenInspector
                  group={activeGroup}
                  participants={participants}
                  projectName={selectedGroupProject?.name ?? null}
                  onClose={() => setInspectorOpen(false)}
                  onCommitDetails={commitDetails}
                  onDebugSession={onDebugSession}
                />
              ) : null}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default GroupChatView;
