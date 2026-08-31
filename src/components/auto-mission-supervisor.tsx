"use client";

import { useEffect, useRef } from "react";
import {
  AUTO_MISSION_CHANGED_EVENT,
  AUTO_MISSION_STORAGE_PREFIX,
  autoMissionSessionIds,
  isAutoMissionArmed,
  readAutoMission,
  type AutoMissionStorage,
} from "@/lib/auto-mission-state";
import {
  ConversationLoadError,
  loadConversation,
} from "@/lib/conversation-cache";
import {
  mapConversationHistoryTurns,
  readLiveChatGeneration,
  subscribeLiveChatGeneration,
  type ConversationHistoryPayload,
} from "@/lib/chat-turn-state";
import { isLiveSnapshotActive } from "@/lib/live-chat-snapshot";
import {
  AUTO_MISSION_WATCH_INTERVAL_MS,
  superviseAutoMissions,
  type AutoMissionNotification,
  type AutoMissionTranscript,
} from "@/lib/auto-mission-supervisor";
import { usePausablePoll } from "@/lib/use-pausable-poll";

function browserStorage(): AutoMissionStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

type ConversationWithFamiliar = NonNullable<ConversationHistoryPayload["conversation"]> & {
  familiarId?: string;
};

/** Read the source of truth without requiring the owning ChatView to exist. */
async function loadAutoMissionTranscript(sessionId: string): Promise<AutoMissionTranscript | null> {
  const live = readLiveChatGeneration(sessionId);
  if (live && isLiveSnapshotActive(live, Date.now())) {
    return { turns: live.turns };
  }

  try {
    const payload = await loadConversation(sessionId) as ConversationHistoryPayload | null;
    if (!payload?.ok || !payload.conversation) return { turns: [] };
    const conversation = payload.conversation as ConversationWithFamiliar;
    return {
      turns: mapConversationHistoryTurns(conversation.turns ?? []),
      familiarId: typeof conversation.familiarId === "string" ? conversation.familiarId : null,
    };
  } catch (error) {
    // A session can be armed before its first durable transcript write. Treat
    // that known absence as an empty transcript; transient/server failures
    // must not advance the watchdog against an unreadable conversation.
    if (error instanceof ConversationLoadError && error.status === 404) {
      return { turns: [] };
    }
    return null;
  }
}

async function postAutoMissionNotification(notification: AutoMissionNotification): Promise<boolean> {
  try {
    const response = await fetch("/api/inbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(notification),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Workspace-owned supervision. This component deliberately renders no UI:
 * the inbox SSE path owns delivery, while this effect remains mounted across
 * Home, Chat, Board, and every other workspace surface.
 */
export function AutoMissionSupervisor({
  intervalMs = AUTO_MISSION_WATCH_INTERVAL_MS,
}: {
  intervalMs?: number;
}) {
  const fingerprintsRef = useRef(new Map<string, string>());
  const subscriptionsRef = useRef(new Map<string, () => void>());
  const runningRef = useRef<Promise<void> | null>(null);
  const rerunRequestedRef = useRef(false);
  const runRef = useRef<() => Promise<void>>(() => Promise.resolve());

  usePausablePoll(() => {
    void runRef.current();
  }, intervalMs);

  useEffect(() => {
    let disposed = false;

    const syncLiveSubscriptions = (storage: AutoMissionStorage, sessionIds: readonly string[]) => {
      const armedIds = new Set(
        sessionIds.filter((sessionId) => isAutoMissionArmed(readAutoMission(sessionId, storage))),
      );
      for (const [sessionId, unsubscribe] of subscriptionsRef.current) {
        if (armedIds.has(sessionId)) continue;
        unsubscribe();
        subscriptionsRef.current.delete(sessionId);
      }
      for (const sessionId of armedIds) {
        if (subscriptionsRef.current.has(sessionId)) continue;
        const unsubscribe = subscribeLiveChatGeneration(sessionId, () => {
          void runRef.current();
        });
        subscriptionsRef.current.set(sessionId, unsubscribe);
      }
    };

    const run = async (): Promise<void> => {
      if (disposed) return;
      if (runningRef.current) {
        rerunRequestedRef.current = true;
        await runningRef.current;
        return;
      }
      const storage = browserStorage();
      if (!storage) return;
      const sessionIds = autoMissionSessionIds(storage);
      syncLiveSubscriptions(storage, sessionIds);
      const task = superviseAutoMissions({
        storage,
        sessionIds,
        loadTranscript: loadAutoMissionTranscript,
        sendNotification: postAutoMissionNotification,
        fingerprints: fingerprintsRef.current,
        nowMs: Date.now(),
        nowIso: new Date().toISOString(),
      }).then(() => undefined);
      runningRef.current = task;
      try {
        await task;
      } finally {
        if (runningRef.current === task) runningRef.current = null;
        if (!disposed && rerunRequestedRef.current) {
          rerunRequestedRef.current = false;
          void run();
        }
      }
    };
    runRef.current = run;

    const onMissionChange = () => {
      void run();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key?.startsWith(AUTO_MISSION_STORAGE_PREFIX)) {
        void run();
      }
    };
    window.addEventListener(AUTO_MISSION_CHANGED_EVENT, onMissionChange);
    window.addEventListener("storage", onStorage);
    void run();

    return () => {
      disposed = true;
      window.removeEventListener(AUTO_MISSION_CHANGED_EVENT, onMissionChange);
      window.removeEventListener("storage", onStorage);
      for (const unsubscribe of subscriptionsRef.current.values()) unsubscribe();
      subscriptionsRef.current.clear();
      runRef.current = () => Promise.resolve();
    };
  }, [intervalMs]);

  return null;
}
