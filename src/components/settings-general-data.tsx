"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePausablePoll } from "@/lib/use-pausable-poll";

export type WorkspaceOverview = { workspacePath: string; envPin?: string | null };
export type BackupSyncOverview = {
  config: {
    enabled: boolean;
    directory: string | null;
    retainCount: number;
    intervalHours: number;
    onQuitPush: boolean;
  };
  status: {
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastSuccessFile: string | null;
    lastError: string | null;
    lastReason: string | null;
    retainedCount: number | null;
  };
  defaultDirectory: string;
  effectiveDirectory: string;
  passphraseSet: boolean;
  due: boolean;
};

type ResourceState<T> = { value: T | null; status: "loading" | "ready" | "error" };

// Each resource owns its request generation. A successful save invalidates any
// older read before publishing to every consumer; background reads keep values.
function useGeneralResource<T>(endpoint: string, valid: (value: T) => boolean, eventName: string) {
  const [state, setState] = useState<ResourceState<T>>({ value: null, status: "loading" });
  const request = useRef<AbortController | null>(null);
  const active = useRef(false);
  const source = useRef({});
  const refresh = useCallback(async () => {
    if (!active.current) return;
    request.current?.abort();
    setState((current) => current.value ? current : { ...current, status: "loading" });
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      const value = await response.json() as T & { ok?: boolean };
      if (!response.ok || !value?.ok || !valid(value)) throw new Error("Settings unavailable");
      if (!controller.signal.aborted) setState({ value, status: "ready" });
    } catch {
      if (!controller.signal.aborted) setState((current) => ({ ...current, status: "error" }));
    }
  }, [endpoint, valid]);
  const publish = useCallback((value: T) => {
    request.current?.abort();
    if (active.current) setState({ value, status: "ready" });
    // A save may finish after this provider unmounts. Notify a newly opened
    // General instance, while this instance keeps the returned value directly.
    window.dispatchEvent(new CustomEvent(eventName, { detail: { source: source.current } }));
  }, [eventName]);
  useEffect(() => {
    active.current = true;
    void refresh();
    const onRefresh = (event: Event) => {
      if ((event as CustomEvent<{ source?: object }>).detail?.source !== source.current) void refresh();
    };
    window.addEventListener(eventName, onRefresh);
    return () => {
      active.current = false;
      request.current?.abort();
      window.removeEventListener(eventName, onRefresh);
    };
  }, [eventName, refresh]);
  return { ...state, refresh, publish };
}

const validWorkspace = (value: WorkspaceOverview) => typeof value.workspacePath === "string" && value.workspacePath.trim().length > 0;
const validSync = (value: BackupSyncOverview) => typeof value.config?.enabled === "boolean" && Boolean(value.status && typeof value.status === "object");

function useGeneralData() {
  const workspace = useGeneralResource<WorkspaceOverview>("/api/config/workspace-path", validWorkspace, "cave:workspace-path-refresh");
  const sync = useGeneralResource<BackupSyncOverview>("/api/backup/sync", validSync, "cave:backup-sync-refresh");
  const refreshWorkspace = workspace.refresh;
  const refreshSync = sync.refresh;
  const refresh = useCallback(() => {
    void refreshWorkspace();
    void refreshSync();
  }, [refreshWorkspace, refreshSync]);
  usePausablePoll(refresh, 30_000, { pauseWhileInputActive: true });
  return { workspace, sync, refresh };
}

const GeneralData = createContext<ReturnType<typeof useGeneralData> | null>(null);

export function GeneralSettingsDataProvider({ children }: { children: ReactNode }) {
  const data = useGeneralData();
  return <GeneralData.Provider value={data}>{children}</GeneralData.Provider>;
}

export function useGeneralSettingsData() {
  return useContext(GeneralData);
}
