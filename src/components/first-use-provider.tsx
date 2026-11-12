"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { parseFirstUseState, type FirstUseAction, type FirstUseContextResolution, type FirstUseState } from "@/lib/first-use";
import type { CaveProject } from "@/lib/cave-projects-types";
import type { EffectiveProjectAccess } from "@/lib/project-access-levels";
import { useAnnouncer } from "@/components/ui/live-region";
import { CHAT_COMPOSER_PREFS_CHANGED_EVENT, restoreReviewedPermissionMode } from "@/lib/chat-composer-prefs";
import { FIRST_USE_OPEN_EVENT, publishFirstUseExecutionState } from "@/lib/first-use-execution";

export type FirstUsePayload = {
  state: FirstUseState;
  resolution: FirstUseContextResolution;
  project: CaveProject | null;
  access: Array<EffectiveProjectAccess & { familiarId: string; supreme: boolean }>;
  starterRoot?: string;
};

type FirstUseContextValue = {
  payload: FirstUsePayload | null;
  loaded: boolean;
  error: string | null;
  busy: boolean;
  open: boolean;
  openGuide: () => void;
  closeGuide: () => void;
  refresh: () => Promise<FirstUsePayload | null>;
  mutate: (action: FirstUseAction, expectedRevision?: number) => Promise<boolean>;
  ensureIntroduction: () => boolean;
};

const FirstUseContext = createContext<FirstUseContextValue | null>(null);

export function FirstUseProvider({ children }: { children: ReactNode }) {
  const [payload, setPayload] = useState<FirstUsePayload | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const requestId = useRef(0);
  const firstLoad = useRef(true);
  const { announce } = useAnnouncer();

  const refresh = useCallback(async () => {
    const generation = ++requestId.current;
    try {
      const response = await fetch("/api/onboarding/journey", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Couldn't restore the introduction. Retry.");
      const next: FirstUsePayload = { ...data, state: parseFirstUseState(data.state) };
      if (generation !== requestId.current || next.state.revision < (payloadRef.current?.state.revision ?? -1)) return null;
      payloadRef.current = next;
      publishFirstUseExecutionState(next.state);
      try { if (restoreReviewedPermissionMode(window.localStorage, next.state.permissionMode ?? "read")) window.dispatchEvent(new Event(CHAT_COMPOSER_PREFS_CHANGED_EVENT)); } catch { /* The guide reports unavailable persistence before access review. */ }
      setPayload(next);
      setError(null);
      setLoaded(true);
      if (firstLoad.current && next.state.revision === 0) setOpen(true);
      firstLoad.current = false;
      return next;
    } catch (cause) {
      if (generation === requestId.current) {
        setError(cause instanceof Error ? cause.message : "Couldn't restore the introduction. Retry.");
        setLoaded(true);
      }
      return null;
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const reload = () => { void refresh(); };
    window.addEventListener("cave:project-access-changed", reload);
    window.addEventListener("focus", reload);
    const show = () => setOpen(true);
    window.addEventListener(FIRST_USE_OPEN_EVENT, show);
    return () => { window.removeEventListener("cave:project-access-changed", reload); window.removeEventListener("focus", reload); window.removeEventListener(FIRST_USE_OPEN_EVENT, show); };
  }, [refresh]);

  const mutate = useCallback(async (action: FirstUseAction, expectedRevision?: number) => {
    const current = payloadRef.current;
    if (!current) return false;
    setBusy(true);
    setError(null);
    ++requestId.current;
    try {
      const response = await fetch("/api/onboarding/journey", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: expectedRevision ?? current.state.revision, action }), signal: AbortSignal.timeout(15_000),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        if (data.code === "first_use_changed") await refresh();
        throw new Error(data.error ?? "Couldn't save introduction progress. Retry.");
      }
      const next: FirstUsePayload = { ...data, starterRoot: current.starterRoot, state: parseFirstUseState(data.state) };
      ++requestId.current;
      if (next.state.revision < (payloadRef.current?.state.revision ?? -1)) throw new Error("The introduction changed in another window. Review the current context before continuing.");
      payloadRef.current = next;
      publishFirstUseExecutionState(next.state);
      setPayload(next);
      announce(next.state.step === "complete" ? "Introduction complete. Your default context is saved." : "Introduction progress saved.");
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Couldn't save introduction progress. Retry.";
      setError(message);
      announce(message, "assertive");
      return false;
    } finally { setBusy(false); }
  }, [announce, refresh]);

  const openGuide = useCallback(() => { setOpen(true); void refresh(); }, [refresh]);
  const closeGuide = useCallback(() => { setOpen(false); announce("Introduction kept. Continue it before starting a run."); }, [announce]);
  const ensureIntroduction = useCallback(() => {
    if (payloadRef.current?.state.step === "complete") return true;
    setOpen(true);
    announce("Complete the introduction before starting a run. Your draft is kept.", "assertive");
    return false;
  }, [announce]);

  return <FirstUseContext.Provider value={{ payload, loaded, error, busy, open, openGuide, closeGuide, refresh, mutate, ensureIntroduction }}>{children}</FirstUseContext.Provider>;
}

export function useFirstUse(): FirstUseContextValue {
  const context = useContext(FirstUseContext);
  if (!context) throw new Error("First-use guidance requires its workspace provider");
  return context;
}
