"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import {
  FEED_MAX_STREAMS,
  FEED_POLL_MS,
  INITIAL_FEED_STATE,
  applyFeedRead,
  feedStreamKey,
  markFeedPass,
  parseFeedRead,
  retainFeedStreams,
  type AutomationFeedRead,
  type AutomationFeedState,
  type AutomationFeedStream,
  type AutomationFeedTopic,
} from "./feed.ts";

/** How often the shown "checked N s ago" is re-judged without a new read. */
const CLOCK_MS = 5_000;

async function readStream(
  automationId: string,
  stream: AutomationFeedStream,
  checkpoint: string | undefined,
  signal: AbortSignal,
): Promise<AutomationFeedRead> {
  const query = new URLSearchParams({ stream: stream.kind });
  if (stream.kind !== "automation") query.set("streamId", stream.id);
  if (checkpoint !== undefined) query.set("checkpoint", checkpoint);
  try {
    const res = await fetch(`/api/coven-automations/${encodeURIComponent(automationId)}/feed?${query}`, { cache: "no-store", signal });
    return parseFeedRead(await res.json().catch(() => null));
  } catch {
    return { kind: "unavailable" };
  }
}

export type AutomationFeedChange = { topics: AutomationFeedTopic[]; reset: boolean };

/**
 * Follow the automation's changefeed while the surface is visible, plus up to
 * FEED_MAX_STREAMS − 1 occurrence or run streams the caller names. Each pass
 * reads every stream once from its checkpoint; `onChange` hears what new
 * events invalidated, once per pass. The hook never holds lifecycle state, and
 * stops reading when hidden or unmounted.
 */
export function useAutomationFeed(
  automationId: string,
  extraStreams: readonly AutomationFeedStream[],
  onChange: (change: AutomationFeedChange) => void,
): { state: AutomationFeedState; now: number; refresh: () => Promise<void> } {
  const [state, setState] = useState<AutomationFeedState>(INITIAL_FEED_STATE);
  const [now, setNow] = useState(() => Date.now());
  const stateRef = useRef(state);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const controllerRef = useRef<AbortController | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  const extraKey = extraStreams.map(feedStreamKey).join("\n");
  const streams = useMemo<AutomationFeedStream[]>(() => {
    const all: AutomationFeedStream[] = [{ kind: "automation", id: automationId }];
    const seen = new Set([feedStreamKey(all[0])]);
    for (const stream of extraStreams) {
      if (all.length >= FEED_MAX_STREAMS) break;
      const key = feedStreamKey(stream);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(stream);
    }
    return all;
    // extraKey captures the contents of extraStreams.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automationId, extraKey]);

  const commit = useCallback((next: AutomationFeedState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const pass = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const run = (async () => {
      let next = retainFeedStreams(stateRef.current, streams);
      const topics = new Set<AutomationFeedTopic>();
      let reset = false;
      let failed = false;
      for (const stream of streams) {
        const read = await readStream(automationId, stream, next.cursors[feedStreamKey(stream)]?.checkpoint, controller.signal);
        if (controller.signal.aborted) return;
        if (read.kind !== "available" && read.kind !== "expired") failed = true;
        const applied = applyFeedRead(next, stream, read, Date.now());
        next = applied.state;
        reset ||= applied.reset;
        for (const topic of applied.changed) topics.add(topic);
      }
      if (!failed) next = markFeedPass(next, Date.now());
      commit(next);
      setNow(Date.now());
      if (topics.size > 0 || reset) onChangeRef.current({ topics: [...topics], reset });
    })();
    inFlight.current = run;
    try {
      await run;
    } finally {
      // An abandoned pass must not release a newer one's slot.
      if (inFlight.current === run) inFlight.current = null;
    }
  }, [automationId, streams, commit]);

  // A different automation starts from nothing; new streams get their baseline read now.
  const automationRef = useRef(automationId);
  useEffect(() => {
    if (automationRef.current !== automationId) {
      automationRef.current = automationId;
      controllerRef.current?.abort();
      inFlight.current = null;
      commit(INITIAL_FEED_STATE);
    }
    void pass();
  }, [automationId, pass, commit]);
  useEffect(() => () => controllerRef.current?.abort(), []);

  usePausablePoll(pass, FEED_POLL_MS, { serialize: true });
  usePausablePoll(() => setNow(Date.now()), CLOCK_MS);

  return { state, now, refresh: pass };
}
