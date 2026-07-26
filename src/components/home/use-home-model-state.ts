"use client";

/**
 * useHomeModelState — the home composer's model/runtime plumbing. No session
 * exists on Home, so GETs key on familiarId only; picks are sticky per
 * familiar (PATCH familiar-default), and runtime switches persist through
 * /api/config. Extracted verbatim from home-composer.tsx.
 */

import { useCallback, useEffect, useState } from "react";
import type { ChatModelState } from "@/lib/chat-model-state";
import { defaultModelForRuntime } from "@/lib/runtime-models";

export function useHomeModelState(selectedFamiliarId: string) {
  const [modelState, setModelState] = useState<ChatModelState | null>(null);

  // Show the selected familiar's effective model on the home composer. No session
  // exists here, so GET keys on familiarId only. The `cancelled` flag drops any
  // out-of-order response when the selection changes mid-flight.
  useEffect(() => {
    if (!selectedFamiliarId) {
      setModelState(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/chat/model-state?familiarId=${encodeURIComponent(selectedFamiliarId)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as { ok?: boolean; state?: ChatModelState };
        if (cancelled) return;
        setModelState(json.ok && json.state ? json.state : null);
      } catch {
        if (!cancelled) setModelState(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedFamiliarId]);

  // A pick at home is sticky per familiar: PATCH familiar-default (the in-chat
  // picker's no-session path). The new chat inherits it at send time.
  const handleSelectModel = useCallback(
    (modelId: string) => {
      if (!selectedFamiliarId) return;
      void (async () => {
        try {
          const res = await fetch("/api/chat/model-state", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              familiarId: selectedFamiliarId,
              model: modelId,
              scope: "familiar-default",
            }),
          });
          const json = (await res.json()) as { ok?: boolean; state?: ChatModelState };
          if (json.ok && json.state) setModelState(json.state);
        } catch {
          /* keep prior state; the effect refetches when the familiar changes */
        }
      })();
    },
    [selectedFamiliarId],
  );

  const refetchModelState = useCallback(() => {
    if (!selectedFamiliarId) return;
    void (async () => {
      try {
        const res = await fetch(
          `/api/chat/model-state?familiarId=${encodeURIComponent(selectedFamiliarId)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as { ok?: boolean; state?: ChatModelState };
        if (json.ok && json.state) setModelState(json.state);
      } catch {
        /* keep the optimistic value */
      }
    })();
  }, [selectedFamiliarId]);

  const handleSelectRuntime = useCallback(
    (runtime: string, selectedModel?: string) => {
      if (!selectedFamiliarId) return;
      const nextModel = selectedModel || defaultModelForRuntime(runtime);
      setModelState((current) => ({
        familiarId: selectedFamiliarId,
        runtime: current?.runtime ?? null,
        harness: runtime,
        effectiveModel: nextModel,
        source: "familiar-default",
        applicationState: "saved",
        reason: "Selected from the home composer.",
      }));
      void (async () => {
        try {
          const res = await fetch("/api/config", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              familiars: {
                [selectedFamiliarId]: { harness: runtime, model: nextModel },
              },
            }),
          });
          const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean };
          if (json.ok) {
            // Roster consumers (chat empty-state identity line, selectors)
            // read familiar.harness — let them catch up immediately.
            window.dispatchEvent(new Event("cave:familiars-refresh"));
            refetchModelState();
          }
        } catch {
          refetchModelState();
        }
      })();
    },
    [refetchModelState, selectedFamiliarId],
  );

  return { modelState, selectModel: handleSelectModel, selectRuntime: handleSelectRuntime };
}
