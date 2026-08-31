"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getResearchRunGateway,
  parseResearchRunGatewaySseFrame,
  researchRunGatewayStreamUrl,
  type ResearchRunGatewaySseFrame,
} from "@/lib/research-run-gateway-client";
import {
  consumeResearchRunEvent,
  createResearchRunEventState,
  rehydrateResearchRun,
  type ResearchRunEventState,
} from "@/lib/research-run-event-reducer";
import type { ResearchMission } from "@/lib/research-missions";
import type { ResearchRunV1 } from "@/lib/research-protocol/research-run";
import {
  hydrateHybridResearchRunProjectionInput,
  researchMissionToRunProjectionInput,
  selectResearchRunProjections,
  type ResearchRunProjections,
} from "@/lib/research-run-projections";

export type ResearchRunGatewayViewState = {
  run: ResearchRunV1 | null;
  eventState: ResearchRunEventState | null;
  status: "idle" | "loading" | "connected" | "reconnecting" | "error";
  error: string | null;
  historyComplete: boolean;
  projections: ResearchRunProjections | null;
  projectionSource: "canonical" | "legacy" | null;
  projectionError: string | null;
  retry(): void;
};

type ResearchRunGatewayTransportState = Pick<
  ResearchRunGatewayViewState,
  "run" | "eventState" | "status" | "error"
> & {
  selector: string | null;
};

const IDLE: ResearchRunGatewayTransportState = {
  selector: null,
  run: null,
  eventState: null,
  status: "idle",
  error: null,
};

function hasCompleteEventHistory(state: ResearchRunEventState | null): state is ResearchRunEventState {
  if (!state || state.sync.status !== "synced" || state.pendingEvents.length > 0) return false;
  const expectedLastSequence = state.run.nextEventSequence - 1;
  return state.lastEventSequence === expectedLastSequence
    && state.appliedEvents.length === expectedLastSequence
    && state.appliedEvents.every((event, index) =>
      event.runId === state.run.id && event.sequence === index + 1);
}

export function useResearchRunGateway(
  missionOrRunId: string | null,
  familiarId: string,
  legacyMission?: ResearchMission | null,
): ResearchRunGatewayViewState {
  const [state, setState] = useState<ResearchRunGatewayTransportState>(IDLE);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const generation = useRef(0);
  const retryPending = useRef(false);
  const retry = useCallback(() => {
    if (!missionOrRunId || retryPending.current) return;
    retryPending.current = true;
    setState((previous) => previous.selector === missionOrRunId
      ? { ...previous, status: "loading", error: null }
      : previous);
    setRetryGeneration((current) => current + 1);
  }, [missionOrRunId]);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    if (!missionOrRunId) {
      retryPending.current = false;
      setState(IDLE);
      return;
    }
    retryPending.current = true;
    const controller = new AbortController();
    let source: EventSource | null = null;
    let stopped = false;

    const current = () => !stopped && generation.current === currentGeneration;
    const applyFrame = (frame: ResearchRunGatewaySseFrame) => {
      if (!current()) return;
      if (frame.kind === "error") {
        source?.close();
        setState((previous) => ({ ...previous, status: "error", error: frame.message }));
        return;
      }
      if (frame.kind === "snapshot") {
        setState((previous) => ({
          selector: missionOrRunId,
          run: frame.run,
          eventState: rehydrateResearchRun(frame.run, [], {
            afterSequence: frame.afterSeq,
            previousState: previous.eventState ?? undefined,
          }),
          status: frame.afterSeq >= frame.lastEventSequence
            ? "connected"
            : previous.status === "reconnecting" ? "reconnecting" : "loading",
          error: null,
        }));
        return;
      }
      setState((previous) => {
        if (!previous.eventState || previous.eventState.run.id !== frame.event.runId) {
          return { ...previous, status: "error", error: "Research Run event belongs to another run" };
        }
        const consumed = consumeResearchRunEvent(previous.eventState, frame.event);
        if (consumed.disposition === "rejected" || consumed.disposition === "conflict") {
          source?.close();
          return {
            ...previous,
            status: "error",
            error: "Research Run event stream requires a fresh snapshot",
          };
        }
        return {
          ...previous,
          run: consumed.state.run,
          eventState: consumed.state,
          status: consumed.state.sync.status === "gap"
            ? "reconnecting"
            : hasCompleteEventHistory(consumed.state)
              ? "connected"
              : previous.status === "reconnecting" ? "reconnecting" : "loading",
          error: consumed.state.sync.status === "gap"
            ? "Research Run event stream has a gap; reconnecting"
            : null,
        };
      });
    };

    const connect = async () => {
      setState((previous) => previous.selector === missionOrRunId
        ? { ...previous, status: "loading", error: null }
        : {
          selector: missionOrRunId,
          run: null,
          eventState: null,
          status: "loading",
          error: null,
        });
      const snapshot = await getResearchRunGateway(missionOrRunId, familiarId, controller.signal);
      if (!current()) return;
      retryPending.current = false;
      if (!snapshot.ok) {
        setState({
          selector: missionOrRunId,
          run: null,
          eventState: null,
          status: "error",
          error: snapshot.error ?? "Research Run could not be loaded",
        });
        return;
      }
      setState({
        selector: missionOrRunId,
        run: snapshot.run,
        eventState: createResearchRunEventState(snapshot.run),
        status: "loading",
        error: null,
      });
      source = new EventSource(
        researchRunGatewayStreamUrl(missionOrRunId, familiarId, 0),
      );
      source.onopen = () => {
        if (current()) {
          setState((previous) => ({
            ...previous,
            status: hasCompleteEventHistory(previous.eventState)
              ? "connected"
              : previous.status === "reconnecting" ? "reconnecting" : "loading",
            error: null,
          }));
        }
      };
      source.addEventListener("snapshot", (event) => {
        const frame = parseResearchRunGatewaySseFrame("snapshot", (event as MessageEvent<string>).data);
        if (frame) applyFrame(frame);
      });
      source.addEventListener("run-event", (event) => {
        const frame = parseResearchRunGatewaySseFrame("run-event", (event as MessageEvent<string>).data);
        if (frame) applyFrame(frame);
      });
      source.onerror = () => {
        if (current()) setState((previous) => ({ ...previous, status: "reconnecting" }));
      };
    };

    void connect().catch((error) => {
      if (current() && (error as Error).name !== "AbortError") {
        retryPending.current = false;
        setState({
          selector: missionOrRunId,
          run: null,
          eventState: null,
          status: "error",
          error: "Research Run gateway could not be loaded",
        });
      }
    });
    return () => {
      stopped = true;
      controller.abort();
      source?.close();
    };
  }, [familiarId, missionOrRunId, retryGeneration]);

  const currentState = state.selector === missionOrRunId
    ? state
    : {
      selector: missionOrRunId,
      run: null,
      eventState: null,
      status: missionOrRunId ? "loading" as const : "idle" as const,
      error: null,
    };
  const historyComplete = hasCompleteEventHistory(currentState.eventState);
  const projection = useMemo(() => {
    if (historyComplete && currentState.eventState) {
      try {
        const hydrated = hydrateHybridResearchRunProjectionInput(
          currentState.eventState.run,
          currentState.eventState.appliedEvents,
          legacyMission,
        );
        return {
          projections: selectResearchRunProjections(hydrated),
          projectionSource: "canonical" as const,
          projectionError: null,
        };
      } catch {
        if (legacyMission) {
          return {
            projections: selectResearchRunProjections(
              researchMissionToRunProjectionInput(legacyMission),
            ),
            projectionSource: "legacy" as const,
            projectionError: "Canonical Research Run history could not be projected",
          };
        }
        return {
          projections: null,
          projectionSource: null,
          projectionError: "Canonical Research Run history could not be projected",
        };
      }
    }
    if (legacyMission) {
      return {
        projections: selectResearchRunProjections(
          researchMissionToRunProjectionInput(legacyMission),
        ),
        projectionSource: "legacy" as const,
        projectionError: null,
      };
    }
    return {
      projections: null,
      projectionSource: null,
      projectionError: null,
    };
  }, [currentState.eventState, historyComplete, legacyMission]);

  return {
    run: currentState.run,
    eventState: currentState.eventState,
    status: currentState.status,
    error: currentState.error,
    historyComplete,
    retry,
    ...projection,
  };
}
