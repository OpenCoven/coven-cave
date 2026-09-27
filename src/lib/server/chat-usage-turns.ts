import { listConversations, loadConversation, type ConversationFile } from "../cave-conversations.ts";
import { cleanModelId } from "../chat-model-state.ts";
import type { TurnUsageLike } from "../chat-usage-plan.ts";

/**
 * The assistant turns a familiar's usage meter totals for one period.
 *
 * Every chat open asks for this, and it used to load and parse every
 * transcript the familiar owns — 1,832 for one familiar on a real profile,
 * 2.6 s cold and 0.76 s warm, all synchronous JSON parsing that stalled the
 * transcript request the user was waiting for (#5617). Two things now bound it:
 *
 * - A conversation last updated before the period starts is skipped: every
 *   write stamps `updatedAt`, so none of its turns can fall inside the period.
 * - Each conversation's usage facts are remembered under its `updatedAt`. An
 *   unchanged conversation is never re-read; any write changes the key. (The
 *   inline-image migration keeps `updatedAt`, and it changes no usage.)
 */

type AssistantTurnFacts = {
  createdAt: unknown;
  usage: TurnUsageLike["usage"];
  costUsd: TurnUsageLike["costUsd"];
  confirmedModel: unknown;
  model: unknown;
};

type ConversationUsageFacts = {
  familiarId: string;
  conversationModels: unknown[];
  turns: AssistantTurnFacts[];
};

const MAX_ENTRIES = 5_000;
const factsBySession = new Map<string, { updatedAt: string; facts: ConversationUsageFacts | null }>();

function usageFacts(conversation: ConversationFile): ConversationUsageFacts {
  return {
    familiarId: conversation.familiarId,
    conversationModels: [conversation.modelIntent?.model, conversation.model],
    turns: conversation.turns
      .filter((turn) => turn.role === "assistant")
      .map((turn) => ({
        createdAt: turn.createdAt,
        usage: turn.usage,
        costUsd: turn.costUsd,
        confirmedModel: turn.responseMetadata?.confirmedModel,
        model: turn.responseMetadata?.model,
      })),
  };
}

async function factsFor(sessionId: string, updatedAt: string): Promise<ConversationUsageFacts | null> {
  const cached = factsBySession.get(sessionId);
  if (cached && cached.updatedAt === updatedAt) return cached.facts;
  const conversation = await loadConversation(sessionId);
  const facts = conversation ? usageFacts(conversation) : null;
  factsBySession.delete(sessionId);
  factsBySession.set(sessionId, { updatedAt, facts });
  while (factsBySession.size > MAX_ENTRIES) {
    const oldest = factsBySession.keys().next().value;
    if (oldest === undefined) break;
    factsBySession.delete(oldest);
  }
  return facts;
}

function sameModel(a: unknown, b: string): boolean {
  const clean = cleanModelId(a);
  if (!clean) return false;
  if (clean === b) return true;
  const aBare = clean.includes("/") ? clean.slice(clean.lastIndexOf("/") + 1) : clean;
  const bBare = b.includes("/") ? b.slice(b.lastIndexOf("/") + 1) : b;
  return aBare === bBare;
}

function inPeriod(value: unknown, startsAt: number, endsAt: number): boolean {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= startsAt && time < endsAt;
}

export async function usageTurnsForPlan(args: {
  familiarId: string;
  sessionId?: string | null;
  model: string;
  startsAt: string;
  endsAt: string;
}): Promise<TurnUsageLike[]> {
  const startsAt = Date.parse(args.startsAt);
  const endsAt = Date.parse(args.endsAt);
  const turns: TurnUsageLike[] = [];
  for (const row of await listConversations()) {
    if (row.familiarId !== args.familiarId) continue;
    const updatedAt = Date.parse(row.updatedAt);
    if (Number.isFinite(updatedAt) && updatedAt < startsAt) continue;
    const facts = await factsFor(row.sessionId, row.updatedAt);
    if (!facts || facts.familiarId !== args.familiarId) continue;
    const conversationModel = facts.conversationModels.some((model) => sameModel(model, args.model));
    for (const turn of facts.turns) {
      if (!inPeriod(turn.createdAt, startsAt, endsAt)) continue;
      if (!(sameModel(turn.confirmedModel, args.model) || sameModel(turn.model, args.model) || conversationModel)) continue;
      turns.push({ usage: turn.usage, costUsd: turn.costUsd });
    }
  }

  // A chat with no attributable turns yet still shows its own usage.
  if (args.sessionId && turns.length === 0) {
    const conversation = await loadConversation(args.sessionId);
    if (conversation?.familiarId === args.familiarId) {
      for (const turn of conversation.turns) {
        if (turn.role !== "assistant") continue;
        if (!inPeriod(turn.createdAt, startsAt, endsAt)) continue;
        turns.push({ usage: turn.usage, costUsd: turn.costUsd });
      }
    }
  }
  return turns;
}

/** Test seam. */
export function clearChatUsageFacts(): void {
  factsBySession.clear();
}
