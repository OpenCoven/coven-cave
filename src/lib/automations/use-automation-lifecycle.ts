"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import {
  LIFECYCLE_MAX_IDS,
  lifecycleView,
  newLifecycleAdoptionKey,
  parseLifecycleCommandResult,
  parseLifecycleOverview,
  type AutomationLifecycleCache,
  type AutomationLifecycleCommand,
  type AutomationLifecycleCommandResult,
  type AutomationLifecycleOverview,
  type AutomationLifecycleView,
} from "./lifecycle.ts";

/** Re-read while the surface is visible. Staleness is judged against LIFECYCLE_STALE_AFTER_MS. */
const REFRESH_MS = 30_000;
/** How often the shown freshness is re-judged without a new read. */
const CLOCK_MS = 15_000;

// The newest read survives a remount within the session, so returning to the
// surface shows the last known state (marked stale once it ages) instead of
// "Checking" for every row.
let sessionCache: AutomationLifecycleCache = { lastGood: null, latest: null };

async function readOverview(ids: readonly string[], signal: AbortSignal): Promise<AutomationLifecycleOverview> {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += LIFECYCLE_MAX_IDS) chunks.push(ids.slice(index, index + LIFECYCLE_MAX_IDS));
  const pages = await Promise.all(chunks.map(async (chunk) => {
    const query = new URLSearchParams(chunk.map((id) => ["id", id]));
    try {
      const res = await fetch(`/api/coven-automation-lifecycle?${query}`, { cache: "no-store", signal });
      return parseLifecycleOverview(await res.json().catch(() => null));
    } catch {
      return { kind: "unavailable" as const };
    }
  }));
  const failed = pages.find((page) => page.kind !== "available");
  if (failed) return failed;
  const available = pages as Extract<AutomationLifecycleOverview, { kind: "available" }>[];
  return {
    kind: "available",
    // The oldest page bounds how fresh the whole read is.
    readAt: available.map((page) => page.readAt).sort()[0] ?? new Date().toISOString(),
    records: available.flatMap((page) => page.records),
  };
}

async function postCommand(
  id: string,
  body: { command: AutomationLifecycleCommand; expectedRevision: number; adoptionKey: string },
): Promise<AutomationLifecycleCommandResult> {
  try {
    const res = await fetch(`/api/coven-automations/${encodeURIComponent(id)}/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return parseLifecycleCommandResult(await res.json().catch(() => ({ kind: "unknown" })));
  } catch {
    // The request may have reached Cave and Coven before the connection failed.
    return { kind: "unknown" };
  }
}

export type AutomationLifecycleHandle = {
  view: (id: string) => AutomationLifecycleView;
  refresh: () => Promise<void>;
  /**
   * Send one pause/resume at the revision the person saw. A lost answer is
   * resent once under the same adoption key, which Coven reconciles instead of
   * applying twice; then the lifecycle is re-read whatever the outcome.
   */
  send: (id: string, command: AutomationLifecycleCommand, expectedRevision: number) => Promise<AutomationLifecycleCommandResult>;
};

export function useAutomationLifecycle(ids: readonly string[]): AutomationLifecycleHandle {
  const [cache, setCache] = useState<AutomationLifecycleCache>(sessionCache);
  const [now, setNow] = useState(() => Date.now());
  const key = useMemo(() => [...new Set(ids)].sort().join("\n"), [ids]);
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const wanted = key ? key.split("\n") : [];
    if (wanted.length === 0) return;
    const request = ++requestRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const result = await readOverview(wanted, controller.signal);
    // A superseded or abandoned read never overwrites a newer one.
    if (request !== requestRef.current || controller.signal.aborted) return;
    setCache((previous) => {
      const next: AutomationLifecycleCache = result.kind === "available"
        ? { lastGood: result, latest: "available" }
        : { lastGood: previous.lastGood, latest: result.kind };
      sessionCache = next;
      return next;
    });
    setNow(Date.now());
  }, [key]);

  useEffect(() => {
    void refresh();
    return () => controllerRef.current?.abort();
  }, [refresh]);
  usePausablePoll(refresh, REFRESH_MS, { enabled: key.length > 0, serialize: true });
  usePausablePoll(() => setNow(Date.now()), CLOCK_MS);

  const view = useCallback((id: string) => lifecycleView(cache, id, now), [cache, now]);

  const send = useCallback(async (id: string, command: AutomationLifecycleCommand, expectedRevision: number) => {
    const body = { command, expectedRevision, adoptionKey: newLifecycleAdoptionKey() };
    let result = await postCommand(id, body);
    if (result.kind === "unknown") result = await postCommand(id, body);
    await refresh();
    return result;
  }, [refresh]);

  return { view, refresh, send };
}
