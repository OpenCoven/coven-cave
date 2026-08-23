/**
 * The chat `/research` command — chat's entry point into the SAME research run
 * the Research Desk works on (#4808).
 *
 * "One run, many projections" only holds if chat does not mint a parallel
 * research model. So this builds an ordinary create-mission request through the
 * shared intent router and stamps a chat origin carrying the conversation id;
 * the run is then a normal mission, visible in the Desk's queue, and the desk
 * can project it back into this exact conversation.
 *
 * Everything here is pure so it can be tested without mounting the chat view.
 */

import { createResearchMissionInputFromIntent } from "./research-mission-routing.ts";
import {
  RESEARCH_INTENT_MAX_LENGTH,
  RESEARCH_INTENT_MIN_LENGTH,
  type CreateResearchMissionInput,
  type ResearchMission,
} from "./research-missions.ts";

export const RESEARCH_CHAT_COMMAND_HELP =
  "Describe what to research — e.g. /research compare managed vector stores for a small team. "
  + "It starts a run in the Research Desk that keeps going while you carry on here.";

export type ResearchChatCommandResult =
  | { ok: true; input: CreateResearchMissionInput }
  | { ok: false; message: string };

/**
 * Build the run request for `/research <intent>`.
 *
 * The length gate is the shared server one, applied here so a too-short intent
 * is answered in the composer's own words instead of as an HTTP 400 — the
 * create route still re-validates, and stays the authority.
 */
export function buildResearchChatRunInput(options: {
  familiarId: string;
  sessionId: string;
  intent: string;
}): ResearchChatCommandResult {
  const intent = options.intent.trim();
  if (!intent) return { ok: false, message: RESEARCH_CHAT_COMMAND_HELP };
  if (intent.length < RESEARCH_INTENT_MIN_LENGTH) {
    return {
      ok: false,
      message: `That is too short to research — give it at least ${RESEARCH_INTENT_MIN_LENGTH} characters. ${RESEARCH_CHAT_COMMAND_HELP}`,
    };
  }
  if (intent.length > RESEARCH_INTENT_MAX_LENGTH) {
    return {
      ok: false,
      message: `That brief is longer than the ${RESEARCH_INTENT_MAX_LENGTH}-character limit. Start it from the Research Desk's Prompt tab instead.`,
    };
  }
  const sessionId = options.sessionId.trim();
  return {
    ok: true,
    input: createResearchMissionInputFromIntent(
      options.familiarId,
      intent,
      // A run started without a conversation to return to records the chat
      // surface and nothing more — a fabricated session id would send the
      // desk's jump somewhere the user never was.
      sessionId ? { surface: "chat", sessionId } : { surface: "chat" },
    ),
  };
}

/** What chat says back once the run exists. Names the run and where it lives,
 *  so the durable record is the run itself rather than this message. */
export function formatResearchRunStarted(mission: ResearchMission): string {
  return `Research started — “${mission.title}”. It runs in the Research Desk (${mission.mode} mode) and keeps going while you carry on here; open the Research Desk to follow its plan, evidence, and report.`;
}
