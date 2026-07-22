"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  actOnResearchMission,
  createResearchMission,
  isActiveResearchMission,
  listResearchMissions,
  runResearchAutomationNow,
  scheduleResearchMission,
  selectStableMission,
  setResearchAutomationStatus,
} from "@/lib/research-mission-client";
import type {
  CreateResearchMissionInput,
  ResearchMission,
  ResearchMissionActionInput,
} from "@/lib/research-missions";
import { usePausablePoll } from "@/lib/use-pausable-poll";

export type ResearchMissionViewState = {
  missions: ResearchMission[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
};

const INITIAL_STATE: ResearchMissionViewState = {
  missions: [],
  selectedId: null,
  loading: true,
  error: null,
};

export function useResearchMissions(familiarId: string) {
  const [state, setState] = useState<ResearchMissionViewState>(INITIAL_STATE);
  // Monotonic load token (the familiar-work-queue-view/daily-notes pattern):
  // every load claims a sequence number and bails before each setState once
  // superseded, and every mutation-applied refresh bumps the token — so an
  // in-flight 2s poll response that predates a user action can never land on
  // top of the fresher state (a just-started mission vanishing until the next
  // poll, an act() result flickering back).
  const loadSeq = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const seq = ++loadSeq.current;
    try {
      const result = await listResearchMissions(familiarId, signal);
      if (signal?.aborted || seq !== loadSeq.current) return; // a newer load or mutation won
      if (!result.ok) {
        setState((current) => ({
          ...current,
          loading: false,
          error: result.error ?? "Research missions could not be loaded",
        }));
        return;
      }
      const missions = result.missions ?? [];
      setState((current) => ({
        missions,
        selectedId: selectStableMission(current.selectedId, missions),
        loading: false,
        error: null,
      }));
    } catch (error) {
      if (signal?.aborted || (error as Error).name === "AbortError") return;
      if (seq !== loadSeq.current) return; // stale failure — leave fresher state intact
      setState((current) => ({
        ...current,
        loading: false,
        error: "Research missions could not be loaded",
      }));
    }
  }, [familiarId]);

  useEffect(() => {
    const controller = new AbortController();
    loadSeq.current += 1; // invalidate in-flight responses from the previous familiar
    setState(INITIAL_STATE);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const active = state.missions.some(isActiveResearchMission);
  usePausablePoll(() => { void load(); }, active ? 2_000 : 15_000, {
    pauseWhileInputActive: true,
  });

  const selected = useMemo(
    () => state.missions.find((mission) => mission.id === state.selectedId) ?? null,
    [state.missions, state.selectedId],
  );

  const select = useCallback((selectedId: string) => {
    setState((current) => ({ ...current, selectedId }));
  }, []);

  const start = useCallback(async (input: CreateResearchMissionInput) => {
    try {
      const result = await createResearchMission(input);
      if (!result.ok || !result.mission) {
        return { ok: false as const, error: result.error ?? "Research could not start" };
      }
      loadSeq.current += 1; // this refresh is the freshest truth — stale polls bail
      setState((current) => ({
        missions: [
          result.mission!,
          ...current.missions.filter((mission) => mission.id !== result.mission!.id),
        ],
        selectedId: result.mission!.id,
        loading: false,
        error: null,
      }));
      return { ok: true as const, mission: result.mission };
    } catch {
      // Transport failure (network reject, non-JSON) resolves to the same
      // failure shape the API path returns — bare awaits must never throw.
      return { ok: false as const, error: "Research could not start" };
    }
  }, []);

  const act = useCallback(async (id: string, input: ResearchMissionActionInput) => {
    try {
      const result = await actOnResearchMission(id, input);
      if (!result.ok || !result.mission) {
        // A refused action usually means the on-screen mission went stale —
        // resync with server truth alongside the failure shape.
        void load();
        return { ok: false as const, error: result.error ?? "Research action failed" };
      }
      loadSeq.current += 1; // this refresh is the freshest truth — stale polls bail
      setState((current) => ({
        ...current,
        missions: current.missions.map((mission) => (
          mission.id === result.mission!.id ? result.mission! : mission
        )),
        selectedId: result.mission!.id,
        error: null,
      }));
      return { ok: true as const, mission: result.mission };
    } catch {
      // Transport failure — the action may still have landed server-side, so
      // resync with server truth before returning the API failure shape.
      void load();
      return { ok: false as const, error: "Research action failed" };
    }
  }, [load]);

  const schedule = useCallback(async (id: string, rrule: string) => {
    try {
      const result = await scheduleResearchMission(id, { rrule });
      if (!result.ok || !result.mission) {
        return { ok: false as const, error: result.error ?? "Research schedule could not be created" };
      }
      loadSeq.current += 1; // this refresh is the freshest truth — stale polls bail
      setState((current) => ({
        ...current,
        missions: current.missions.map((mission) => (
          mission.id === result.mission!.id ? result.mission! : mission
        )),
        error: null,
      }));
      return { ok: true as const, mission: result.mission };
    } catch {
      // Transport failure resolves to the same failure shape the API returns.
      return { ok: false as const, error: "Research schedule could not be created" };
    }
  }, []);

  const controlAutomation = useCallback(async (
    missionId: string,
    automationId: string,
    action: "pause" | "resume" | "run-now",
  ) => {
    try {
      const result = action === "run-now"
        ? await runResearchAutomationNow(automationId)
        : await setResearchAutomationStatus(automationId, action === "resume" ? "ACTIVE" : "PAUSED");
      if (!result.ok) {
        return { ok: false as const, error: result.error ?? "Automation action failed" };
      }
      if (action !== "run-now") {
        loadSeq.current += 1; // this refresh is the freshest truth — stale polls bail
        setState((current) => ({
          ...current,
          missions: current.missions.map((mission) => mission.id === missionId && mission.automation ? {
            ...mission,
            automation: {
              ...mission.automation,
              status: action === "resume" ? "ACTIVE" : "PAUSED",
              stopReason: undefined,
            },
          } : mission),
        }));
      }
      void load();
      return { ok: true as const };
    } catch {
      // Transport failure resolves to the same failure shape the API returns.
      return { ok: false as const, error: "Automation action failed" };
    }
  }, [load]);

  return { ...state, selected, select, start, act, schedule, controlAutomation, load };
}
