"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createDaemonStatusRequestGate } from "@/lib/daemon-desktop-auto-start";
import { usePausablePoll } from "@/lib/use-pausable-poll";

type DaemonStatusFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "json">>;

type LocalDaemonReadinessControllerInput = {
  fetchImpl: DaemonStatusFetch;
  publish(accepted: boolean): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function exactLocalDaemonStatusAccepted(
  responseOk: boolean,
  payload: unknown,
): boolean {
  if (!responseOk || !isRecord(payload) || !isRecord(payload.target)) {
    return false;
  }
  return payload.running === true && payload.target.mode === "local";
}

export function createLocalDaemonReadinessController({
  fetchImpl,
  publish,
}: LocalDaemonReadinessControllerInput) {
  const requestGate = createDaemonStatusRequestGate();
  let mounted = false;

  return {
    mount(): void {
      mounted = true;
    },

    unmount(): void {
      mounted = false;
      requestGate.begin();
    },

    async refresh(): Promise<void> {
      const requestId = requestGate.begin();
      let accepted = false;
      try {
        const response = await fetchImpl("/api/daemon/status", {
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        accepted = exactLocalDaemonStatusAccepted(response.ok, payload);
      } catch {
        accepted = false;
      }
      if (!mounted || !requestGate.isLatest(requestId)) return;
      publish(accepted);
    },
  };
}

export function useLocalDaemonReadiness(): {
  acceptedLocalDaemonHealthy: boolean;
  refreshLocalDaemonReadiness(): Promise<void>;
} {
  const [acceptedLocalDaemonHealthy, setAcceptedLocalDaemonHealthy] =
    useState(false);
  const controllerRef = useRef<ReturnType<
    typeof createLocalDaemonReadinessController
  > | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createLocalDaemonReadinessController({
      fetchImpl: (...args) => fetch(...args),
      publish: setAcceptedLocalDaemonHealthy,
    });
  }

  const refreshLocalDaemonReadiness = useCallback(
    () => controllerRef.current!.refresh(),
    [],
  );

  useEffect(() => {
    const controller = controllerRef.current!;
    controller.mount();
    void refreshLocalDaemonReadiness();
    return () => controller.unmount();
  }, [refreshLocalDaemonReadiness]);

  usePausablePoll(
    () => void refreshLocalDaemonReadiness(),
    5_000,
    { pauseWhileInputActive: true },
  );

  return {
    acceptedLocalDaemonHealthy,
    refreshLocalDaemonReadiness,
  };
}
