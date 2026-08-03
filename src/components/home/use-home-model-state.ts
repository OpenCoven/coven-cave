"use client";

/**
 * useHomeModelState — the home composer's model/runtime plumbing. No session
 * exists on Home, so GETs key on familiarId only; picks are sticky per
 * familiar (PATCH familiar-default), and runtime switches persist through
 * /api/config. Extracted verbatim from home-composer.tsx.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatModelState } from "@/lib/chat-model-state";
import {
  createModelSelectionMutationQueue,
  type ModelSelectionMutationQueue,
} from "@/lib/model-selection-mutation-queue";
import { modelForRuntimeSwitch } from "@/lib/runtime-models";

export function useHomeModelState(selectedFamiliarId: string) {
  const [modelState, setModelState] = useState<ChatModelState | null>(null);
  // A Home selection can be followed by an immediate Chat handoff, before the
  // familiar-default PATCH has completed. Keep the selected wire value so the
  // first send can carry it independently of the soon-to-unmount Home state.
  const [pendingModelOverride, setPendingModelOverride] = useState<string | undefined>(undefined);
  const mutationQueueRef = useRef<ModelSelectionMutationQueue>(
    createModelSelectionMutationQueue(),
  );
  const selectedFamiliarIdRef = useRef(selectedFamiliarId);
  selectedFamiliarIdRef.current = selectedFamiliarId;
  const selectionRevisionRef = useRef(0);
  const modelStateRequestRef = useRef(0);
  const runtimeWriteRef = useRef<Promise<boolean> | null>(null);

  // Show the selected familiar's effective model on the home composer. No session
  // exists here, so GET keys on familiarId only. The `cancelled` flag drops any
  // out-of-order response when the selection changes mid-flight.
  useEffect(() => {
    const familiarId = selectedFamiliarId;
    const selectionRevision = ++selectionRevisionRef.current;
    const requestId = ++modelStateRequestRef.current;
    // Do not leave the previous familiar's state visible while this familiar's
    // request is pending. The same guard also protects a late response from a
    // familiar that was selected before this one.
    setModelState(null);
    setPendingModelOverride(undefined);
    runtimeWriteRef.current = null;
    if (!selectedFamiliarId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/chat/model-state?familiarId=${encodeURIComponent(familiarId)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as { ok?: boolean; state?: ChatModelState };
        if (
          cancelled
          || familiarId !== selectedFamiliarIdRef.current
          || selectionRevision !== selectionRevisionRef.current
          || requestId !== modelStateRequestRef.current
        ) return;
        setModelState(json.ok && json.state ? json.state : null);
      } catch {
        if (
          !cancelled
          && familiarId === selectedFamiliarIdRef.current
          && selectionRevision === selectionRevisionRef.current
          && requestId === modelStateRequestRef.current
        ) setModelState(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedFamiliarId]);

  const refetchModelState = useCallback((
    expectedSelectionRevision = selectionRevisionRef.current,
    familiarId = selectedFamiliarId,
  ) => {
    if (!familiarId) return;
    const requestId = ++modelStateRequestRef.current;
    void (async () => {
      try {
        const res = await fetch(
          `/api/chat/model-state?familiarId=${encodeURIComponent(familiarId)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as { ok?: boolean; state?: ChatModelState };
        if (
          familiarId === selectedFamiliarIdRef.current
          && expectedSelectionRevision === selectionRevisionRef.current
          && requestId === modelStateRequestRef.current
          && json.ok
          && json.state
        ) setModelState(json.state);
      } catch {
        /* keep the optimistic value */
      }
    })();
  }, [selectedFamiliarId]);

  // A pick at home is sticky per familiar: PATCH familiar-default (the in-chat
  // picker's no-session path). The new chat inherits it at send time.
  const handleSelectModel = useCallback(
    (modelId: string | null) => {
      const familiarId = selectedFamiliarId;
      if (!familiarId) return;
      const selectionRevision = ++selectionRevisionRef.current;
      const stagedModel = modelId ?? "";
      setPendingModelOverride(stagedModel);
      setModelState((current) => current ? {
        ...current,
        effectiveModel: stagedModel,
        source: stagedModel ? "familiar-default" : "runtime-default",
        familiarDefaultModel: stagedModel || null,
        applicationState: "pending",
        reason: stagedModel
          ? "Selected from the home composer; waiting for the familiar default to save."
          : "Using the runtime's configured default model.",
      } : current);
      void mutationQueueRef.current.enqueue(async () => {
        // A queued operation from a familiar the user already left must not
        // become a delayed write against that old selection.
        if (selectedFamiliarIdRef.current !== familiarId) return null;
        const res = await fetch("/api/chat/model-state", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            familiarId,
            // Keep an explicit empty value so clearing a familiar default
            // remains a durable Runtime-default intent instead of deleting
            // the field and re-inheriting a stale Cave/global model.
            model: stagedModel,
            scope: "familiar-default",
          }),
        });
        return (await res.json()) as { ok?: boolean; state?: ChatModelState };
      }).then((json) => {
        if (
          !json
          || familiarId !== selectedFamiliarIdRef.current
          || selectionRevision !== selectionRevisionRef.current
        ) return;
        if (json.ok && json.state) setModelState(json.state);
        else refetchModelState(selectionRevision, familiarId);
      }).catch(() => {
        if (
          familiarId === selectedFamiliarIdRef.current
          && selectionRevision === selectionRevisionRef.current
        ) refetchModelState(selectionRevision, familiarId);
      });
    },
    [refetchModelState, selectedFamiliarId],
  );

  const handleSelectRuntime = useCallback(
    (runtime: string, selectedModel?: string) => {
      const familiarId = selectedFamiliarId;
      if (!familiarId) return;
      const selectionRevision = ++selectionRevisionRef.current;
      const nextModel = modelForRuntimeSwitch(runtime, selectedModel);
      setPendingModelOverride(nextModel);
      setModelState((current) => ({
        familiarId,
        runtime: current?.runtime ?? null,
        harness: runtime,
        effectiveModel: nextModel,
        source: nextModel ? "familiar-default" : "runtime-default",
        // Home picks write familiar-DEFAULT scope, so the optimistic state's
        // stored default moves with the selection (cleared when unset).
        familiarDefaultModel: nextModel || null,
        applicationState: "saved",
        reason: nextModel
          ? "Selected from the home composer."
          : "Using the runtime's configured default model.",
      }));
      const runtimeWrite = mutationQueueRef.current.enqueue(async () => {
        if (selectedFamiliarIdRef.current !== familiarId) return false;
        const res = await fetch("/api/config", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            familiars: {
              [familiarId]: {
                harness: runtime,
                model: nextModel,
              },
            },
          }),
        });
        const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean };
        return json.ok === true;
      }).then((ok) => {
        if (
          !ok
          || familiarId !== selectedFamiliarIdRef.current
          || selectionRevision !== selectionRevisionRef.current
        ) {
          if (
            !ok
            && familiarId === selectedFamiliarIdRef.current
            && selectionRevision === selectionRevisionRef.current
          ) refetchModelState(selectionRevision, familiarId);
          return ok;
        }
        // Roster consumers (chat empty-state identity line, selectors) read
        // familiar.harness — let them catch up immediately.
        window.dispatchEvent(new Event("cave:familiars-refresh"));
        refetchModelState(selectionRevision, familiarId);
        return ok;
      }).catch(() => {
        if (
          familiarId === selectedFamiliarIdRef.current
          && selectionRevision === selectionRevisionRef.current
        ) refetchModelState(selectionRevision, familiarId);
        return false;
      });
      runtimeWriteRef.current = runtimeWrite;
    },
    [refetchModelState, selectedFamiliarId],
  );

  const waitForRuntimeWrite = useCallback(async () => {
    const runtimeWrite = runtimeWriteRef.current;
    if (!runtimeWrite) return true;
    return runtimeWrite;
  }, []);

  return {
    modelState,
    pendingModelOverride,
    waitForRuntimeWrite,
    selectModel: handleSelectModel,
    selectRuntime: handleSelectRuntime,
  };
}
