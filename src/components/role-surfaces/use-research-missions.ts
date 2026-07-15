"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await listResearchMissions(familiarId, signal);
      if (signal?.aborted) return;
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
      setState((current) => ({
        ...current,
        loading: false,
        error: "Research missions could not be loaded",
      }));
    }
  }, [familiarId]);

  useEffect(() => {
    const controller = new AbortController();
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
    const result = await createResearchMission(input);
    if (!result.ok || !result.mission) {
      return { ok: false as const, error: result.error ?? "Research could not start" };
    }
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
  }, []);

  const act = useCallback(async (id: string, input: ResearchMissionActionInput) => {
    const result = await actOnResearchMission(id, input);
    if (!result.ok || !result.mission) {
      return { ok: false as const, error: result.error ?? "Research action failed" };
    }
    setState((current) => ({
      ...current,
      missions: current.missions.map((mission) => (
        mission.id === result.mission!.id ? result.mission! : mission
      )),
      selectedId: result.mission!.id,
      error: null,
    }));
    return { ok: true as const, mission: result.mission };
  }, []);

  const schedule = useCallback(async (id: string, rrule: string) => {
    const result = await scheduleResearchMission(id, { rrule });
    if (!result.ok || !result.mission) {
      return { ok: false as const, error: result.error ?? "Research schedule could not be created" };
    }
    setState((current) => ({
      ...current,
      missions: current.missions.map((mission) => (
        mission.id === result.mission!.id ? result.mission! : mission
      )),
      error: null,
    }));
    return { ok: true as const, mission: result.mission };
  }, []);

  const controlAutomation = useCallback(async (
    missionId: string,
    automationId: string,
    action: "pause" | "resume" | "run-now",
  ) => {
    const result = action === "run-now"
      ? await runResearchAutomationNow(automationId)
      : await setResearchAutomationStatus(automationId, action === "resume" ? "ACTIVE" : "PAUSED");
    if (!result.ok) {
      return { ok: false as const, error: result.error ?? "Automation action failed" };
    }
    if (action !== "run-now") {
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
  }, [load]);

  return { ...state, selected, select, start, act, schedule, controlAutomation, load };
}
