/**
 * "What is happening, and what should I do?" for a research mission.
 *
 * The desk showed a status word ("checkpoint", "paused") and a row of buttons,
 * which asks the reader to already know what a checkpoint is and which button
 * advances it. Two questions went unanswered on screen:
 *
 *   1. Is anything happening right now, or is it waiting on ME?
 *   2. Is the schedule actually working, or merely switched on?
 *
 * Both answers are derived here rather than written into the markup so they
 * cannot drift from the real state. The available actions come from
 * allowedResearchActions — the same function the buttons use — so a state that
 * gains or loses an action can never disagree with its own description.
 */

import {
  allowedResearchActions,
  type ResearchMission,
  type ResearchMissionAction,
} from "@/lib/research-missions";

export type ResearchWaitingOn = "familiar" | "you" | "schedule" | "nobody";

export type ResearchNextStep = {
  /** Who the mission is waiting on — drives the tone of the whole panel. */
  waitingOn: ResearchWaitingOn;
  /** One sentence: what state the mission is in, in plain language. */
  headline: string;
  /** One sentence: what happens next, or what the reader should do. */
  detail: string;
  /** The action to lead with, when one is clearly primary. */
  primaryAction?: ResearchMissionAction;
  actions: ResearchMissionAction[];
};

const ACTION_LABELS: Record<ResearchMissionAction, string> = {
  retry: "Retry",
  continue: "Continue",
  refine: "Refine",
  finish: "Finish now",
  pause: "Pause",
  resume: "Resume",
  cancel: "Cancel",
  archive: "Archive",
};

export function researchActionLabel(action: ResearchMissionAction): string {
  return ACTION_LABELS[action];
}

export function researchNextStep(mission: ResearchMission): ResearchNextStep {
  const actions = allowedResearchActions(mission);
  const pass = mission.iterations.at(-1)?.number ?? 1;
  const maxPasses = mission.bounds.maxIterations;
  const has = (action: ResearchMissionAction) => actions.includes(action);

  switch (mission.status) {
    case "queued":
    case "planning":
      return {
        waitingOn: "familiar",
        headline: "Starting the first pass.",
        // Naming Cancel matters here: it is the ONLY action in this state, so a
        // reader who sees one button should know that is not an oversight.
        detail: "Nothing to do — the familiar is spinning up. Cancel stops it before any work happens.",
        actions,
      };
    case "running":
      return {
        waitingOn: "familiar",
        headline: `Pass ${pass} of ${maxPasses} is running.`,
        detail: "Sources and artifacts appear as they land. You can leave this page; the pass keeps going.",
        actions,
      };
    case "checkpoint":
      return {
        waitingOn: "you",
        headline: `Pass ${pass} paused at a checkpoint for your call.`,
        // The bounded-loop contract: it will NOT resume on its own. That is the
        // single fact a stalled-looking mission most often needs to convey.
        detail: "It will not continue on its own. Continue for another pass, Refine to change direction, or Finish with what it has.",
        primaryAction: has("continue") ? "continue" : undefined,
        actions,
      };
    case "paused":
      return {
        waitingOn: "you",
        headline: "Paused — waiting on you.",
        detail: "Resume picks up where it stopped. Refine changes the direction first; Finish accepts what exists now.",
        primaryAction: has("resume") ? "resume" : undefined,
        actions,
      };
    case "failed":
      return {
        waitingOn: "you",
        headline: "The last pass failed.",
        // Point at the recorded cause instead of making the reader hunt for it.
        detail: mission.lastError
          ? `${mission.lastError} Retry starts a fresh pass; Finish keeps whatever landed.`
          : "Retry starts a fresh pass. Finish keeps whatever landed before the failure.",
        primaryAction: has("retry") ? "retry" : undefined,
        actions,
      };
    case "completed":
      return {
        waitingOn: "nobody",
        headline: "Finished.",
        detail: `${mission.sources.length} source${mission.sources.length === 1 ? "" : "s"} gathered over ${pass} pass${pass === 1 ? "" : "es"}. Continue reopens it for another pass; Archive files it away.`,
        actions,
      };
    case "cancelled":
      return {
        waitingOn: "nobody",
        headline: "Cancelled.",
        detail: "Nothing is running. Continue reopens it for another pass; Archive files it away.",
        actions,
      };
    case "archived":
      return {
        waitingOn: "nobody",
        headline: "Archived.",
        detail: "Read-only. Its artifacts and sources are still here.",
        actions,
      };
  }
}

export type ResearchAutomationHealth = {
  /**
   * `failing` is deliberately distinct from `paused`: an ACTIVE schedule whose
   * last run failed looks healthy everywhere that only prints ACTIVE, which is
   * exactly the "is the automation working?" question going unanswered.
   */
  state: "none" | "paused" | "stopped" | "failing" | "running" | "healthy";
  label: string;
  detail: string;
};

export function researchAutomationHealth(mission: ResearchMission): ResearchAutomationHealth {
  const automation = mission.automation;
  if (!automation) {
    return {
      state: "none",
      label: "Not scheduled",
      detail: "This mission runs only when you start a pass.",
    };
  }
  // A stop reason outranks the on/off switch: the schedule may still read
  // ACTIVE while the runner has given up on it.
  if (automation.stopReason) {
    return {
      state: "stopped",
      label: "Stopped",
      detail: automation.stopReason,
    };
  }
  if (automation.lastRunStatus === "failed") {
    return {
      state: "failing",
      label: "Last run failed",
      detail: automation.status === "ACTIVE"
        ? "The schedule is still on and will try again at its next time."
        : "The schedule is paused, so it will not retry until you resume it.",
    };
  }
  if (automation.status !== "ACTIVE") {
    return {
      state: "paused",
      label: "Paused",
      detail: "It will not run on its own until you resume it.",
    };
  }
  if (automation.lastRunStatus === "running" || automation.lastRunStatus === "queued") {
    return {
      state: "running",
      label: "Running now",
      detail: "A scheduled pass is in flight.",
    };
  }
  return {
    state: "healthy",
    label: "On",
    detail: automation.lastRunStatus === "succeeded"
      ? "The last scheduled pass succeeded."
      // Never claim a successful history that does not exist yet.
      : "No scheduled pass has run yet.",
  };
}
