import {
  defaultGroupName,
  makeGroup,
  setGroupProject,
  setGroupSession,
  upsertGroup,
  type CovenGroup,
} from "./group-chat.ts";

/**
 * Turning a solo chat into a coven.
 *
 * A coven is not a different kind of session — `CovenGroup.sessions` is a
 * `familiarId → sessionId` map over ordinary `/api/chat/send` threads. So
 * "add someone to this chat" does not migrate anything: it builds a group that
 * already pins the thread you are looking at as its author's session, and the
 * coven surface resumes it. The conversation you were having continues; the
 * new participant simply starts their own alongside it.
 */

export type PromotionParticipant = {
  id: string;
  /** Display name, used only to name the group. */
  name: string;
};

export type PromoteToCovenInput = {
  /** Groups as currently persisted. */
  groups: CovenGroup[];
  /** The familiar whose solo thread is being promoted. */
  host: PromotionParticipant;
  /** Familiars being added alongside the host. */
  added: PromotionParticipant[];
  /** The live thread to carry over. Null for a chat that has not started. */
  sessionId: string | null;
  /** Registered project the chat is scoped to, if any. */
  projectId: string | null;
  now: string;
  /** Caller-supplied id so this stays pure and testable. */
  groupId: string;
};

export type PromoteToCovenResult = {
  groups: CovenGroup[];
  group: CovenGroup;
  /** True when the host's existing thread was carried into the group. */
  carriedSession: boolean;
};

/**
 * Build the group a solo chat is promoted into. Pure: the caller persists the
 * returned list and routes to the coven surface.
 */
export function promoteSessionToCoven(input: PromoteToCovenInput): PromoteToCovenResult {
  const { groups, host, added, sessionId, projectId, now, groupId } = input;
  const participants = [host, ...added.filter((f) => f.id !== host.id)];
  const ids = participants.map((f) => f.id);

  let group = makeGroup(defaultGroupName(participants.map((f) => f.name)), ids, now, groupId);
  // Project BEFORE session, and never the other way round: setGroupProject
  // wipes `sessions` because harness session ids are cwd-scoped, so pinning
  // first would silently discard the very thread we are carrying over.
  if (projectId) group = setGroupProject(group, projectId, now);
  const carriedSession = Boolean(sessionId);
  if (sessionId) group = setGroupSession(group, host.id, sessionId, now);

  return { groups: upsertGroup(groups, group), group, carriedSession };
}

/**
 * Familiars that can still be added to a solo chat: everyone but the host, and
 * anyone already in the group when re-opening the roster.
 */
export function addableFamiliars<T extends { id: string }>(
  familiars: T[],
  hostId: string,
  alreadyAdded: readonly string[] = [],
): T[] {
  const taken = new Set<string>([hostId, ...alreadyAdded]);
  return familiars.filter((f) => !taken.has(f.id));
}
