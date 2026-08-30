"use client";

import { useEffect, useRef, useState } from "react";

import {
  getResearchRunGateway,
  parseResearchRunGatewaySseFrame,
  researchRunGatewayStreamUrl,
  type ResearchRunGatewaySseFrame,
} from "@/lib/research-run-gateway-client";
import {
  consumeResearchRunEvent,
  createResearchRunEventState,
  type ResearchRunEventState,
} from "@/lib/research-run-event-reducer";
import type { ResearchRunV1 } from "@/lib/research-protocol/research-run";

export type ResearchRunGatewayViewState = {
  run: ResearchRunV1 | null;
  eventState: ResearchRunEventState | null;
  status: "idle" | "loading" | "connected" | "reconnecting" | "error";
  error: string | null;
};

const IDLE: ResearchRunGatewayViewState = {
  run: null,
  eventState: null,
  status: "idle",
  error: null,
};

export function useResearchRunGateway(
  missionOrRunId: string | null,
  familiarId: string,
): ResearchRunGatewayViewState {
  const [state, setState] = useState<ResearchRunGatewayViewState>(IDLE);
  const generation = useRef(0);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    if (!missionOrRunId) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    let source: EventSource | null = null;
    let stopped = false;

    const current = () => !stopped && generation.current === currentGeneration;
    const applyFrame = (frame: ResearchRunGatewaySseFrame) => {
      if (!current()) return;
      if (frame.kind === "error") {
        setState((previous) => ({ ...previous, status: "error", error: frame.message }));
        return;
      }
      if (frame.kind === "snapshot") {
        setState({
          run: frame.run,
          eventState: createResearchRunEventState(frame.run),
          status: "connected",
          error: null,
        });
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
          error: consumed.state.sync.status === "gap"
            ? "Research Run event stream has a gap; reconnecting"
            : null,
        };
      });
    };

    const connect = async () => {
      setState({ run: null, eventState: null, status: "loading", error: null });
      const snapshot = await getResearchRunGateway(missionOrRunId, familiarId, controller.signal);
      if (!current()) return;
      if (!snapshot.ok) {
        setState({ run: null, eventState: null, status: "error", error: snapshot.error ?? "Research Run could not be loaded" });
        return;
      }
      setState({
        run: snapshot.run,
        eventState: createResearchRunEventState(snapshot.run),
        status: "loading",
        error: null,
      });
      source = new EventSource(
        researchRunGatewayStreamUrl(missionOrRunId, familiarId, snapshot.lastEventSequence),
      );
      source.onopen = () => {
        if (current()) setState((previous) => ({ ...previous, status: "connected", error: null }));
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
        setState({ run: null, eventState: null, status: "error", error: "Research Run gateway could not be loaded" });
      }
    });
    return () => {
      stopped = true;
      controller.abort();
      source?.close();
    };
  }, [familiarId, missionOrRunId]);

  return state;
}
