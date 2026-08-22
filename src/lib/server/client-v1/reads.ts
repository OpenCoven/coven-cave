/**
 * Canonical read projections for the Client v1 resource routes.
 *
 * Every shape here is derived from a store Cave already keeps, never invented:
 *
 *   - familiars      `VisibleFamiliarRosterEntry` (server/familiar-roster.ts),
 *                    the daemon roster merged with familiars.toml and the
 *                    removal tombstones.
 *   - projects       `CaveProject` (cave-projects-types.ts), the
 *                    `<caveHome>/projects.json` registry.
 *   - conversations  `ConversationSummary` (cave-conversations.ts), what
 *                    listConversations reads out of
 *                    `<caveHome>/conversations/*.json`.
 *   - messages       `ChatTurn` from the same transcript file.
 *
 * A projection is narrower than its record on purpose. Two rules decide what
 * survives: a field has to describe the resource to a *client* (so the Cave's
 * own migration scaffolding and PR-badge attribution do not), and it must not
 * hand over content the client did not ask for by holding `chat:read` (so a
 * turn's reasoning and its tool arguments do not — see projectClientV1Message).
 *
 * Optional fields are omitted rather than set to `undefined`. The envelope
 * builder runs every payload through parseClientV1JsonObject, which rejects a
 * key whose value is `undefined`, so `{ title: summary.title }` on a
 * conversation with no title throws on the way out rather than serving a null.
 */

import type { ChatTurn, ConversationFile, ConversationSummary } from "../../cave-conversations.ts";
import type { CaveProject } from "../../cave-projects-types.ts";
import { resolveActivePath } from "../../conversation-tree.ts";
import type { VisibleFamiliarRosterEntry } from "../familiar-roster.ts";
import {
  compareClientV1AscendingKeys,
  compareClientV1RecencyKeys,
  type ClientV1PageKey,
} from "./pagination.ts";

export type ClientV1FamiliarRecord = {
  id: string;
  displayName: string;
  role: string;
  description?: string;
  pronouns?: string;
  status?: string;
  /**
   * The daemon's `last_seen`, passed through verbatim.
   *
   * Deliberately not validated as an ISO instant and not renamed to something
   * that promises one: the value originates in the daemon, Cave neither writes
   * nor parses it, and re-stamping it here would state a precision Cave cannot
   * vouch for.
   */
  lastSeenAt?: string;
  activeSessions?: number;
};

export type ClientV1ProjectRecord = {
  id: string;
  name: string;
  /**
   * The project's absolute root.
   *
   * A path, and published on purpose: it is the registry's real identity (the
   * loader dedupes by normalized root, not by id), and a paired Client v1
   * credential belongs to an application running as this same user on this
   * same machine, which can already read the directory it names.
   */
  root: string;
  color?: string;
  repoUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type ClientV1ConversationRecord = {
  id: string;
  familiarId: string;
  harness?: string;
  model?: string;
  runtime?: string;
  title?: string;
  origin?: string;
  status?: string;
  exitCode?: number | null;
  pending?: boolean;
  createdAt?: string;
  updatedAt: string;
};

export type ClientV1MessageRecord = {
  id: string;
  conversationId: string;
  parentId: string | null;
  role: ChatTurn["role"];
  text: string;
  createdAt: string;
  attachmentCount: number;
  toolCount: number;
  isError?: boolean;
  cancelled?: boolean;
};

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function projectClientV1Familiar(
  entry: VisibleFamiliarRosterEntry,
): ClientV1FamiliarRecord {
  const description = optionalText(entry.description);
  const pronouns = optionalText(entry.pronouns);
  const status = optionalText(entry.status);
  const lastSeenAt = optionalText(entry.last_seen);
  const activeSessions = optionalCount(entry.active_sessions);
  return {
    id: entry.id,
    displayName: entry.display_name,
    role: entry.role,
    ...(description ? { description } : {}),
    ...(pronouns ? { pronouns } : {}),
    ...(status ? { status } : {}),
    ...(lastSeenAt ? { lastSeenAt } : {}),
    ...(activeSessions === undefined ? {} : { activeSessions }),
  };
}

export function projectClientV1Project(project: CaveProject): ClientV1ProjectRecord {
  const color = optionalText(project.color);
  const repoUrl = optionalText(project.repoUrl);
  return {
    id: project.id,
    name: project.name,
    root: project.root,
    ...(color ? { color } : {}),
    ...(repoUrl ? { repoUrl } : {}),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function projectClientV1Conversation(
  summary: ConversationSummary,
): ClientV1ConversationRecord {
  const harness = optionalText(summary.harness);
  const model = optionalText(summary.model);
  const runtime = optionalText(summary.runtime);
  const title = optionalText(summary.title);
  const origin = optionalText(summary.origin);
  const status = optionalText(summary.status);
  const createdAt = optionalText(summary.createdAt);
  return {
    id: summary.sessionId,
    familiarId: summary.familiarId,
    ...(harness ? { harness } : {}),
    ...(model ? { model } : {}),
    ...(runtime ? { runtime } : {}),
    ...(title ? { title } : {}),
    ...(origin ? { origin } : {}),
    ...(status ? { status } : {}),
    // `null` is a fact — the run has no exit code yet — so it is served, while
    // `undefined` (the store never recorded one) is omitted.
    ...(summary.exitCode === undefined ? {} : { exitCode: summary.exitCode }),
    ...(summary.pending === undefined ? {} : { pending: summary.pending }),
    ...(createdAt ? { createdAt } : {}),
    updatedAt: summary.updatedAt,
  };
}

export function projectClientV1Message(
  conversationId: string,
  turn: ChatTurn,
): ClientV1MessageRecord {
  return {
    id: turn.id,
    conversationId,
    // `undefined` on a legacy turn, `null` on an authored root. Both mean root,
    // and only one of them is a value the envelope can carry.
    parentId: turn.parentId ?? null,
    role: turn.role,
    text: turn.text,
    createdAt: turn.createdAt,
    // Counts, not contents. `reasoning` is the harness's private scratchpad and
    // a tool call carries whatever the tool was pointed at — a path, a command,
    // a file it read. `chat:read` is a grant to read the conversation, not to
    // read everything the conversation touched.
    attachmentCount: countOf(turn.attachments),
    toolCount: countOf(turn.tools),
    ...(turn.isError === undefined ? {} : { isError: turn.isError }),
    ...(turn.cancelled === undefined ? {} : { cancelled: turn.cancelled }),
  };
}

/**
 * The turns a client should see, in the order Cave renders them.
 *
 * `ConversationFile.turns` is every turn of every branch in one append-ordered
 * array; the rendered conversation is the chain from `activeLeafId` to the
 * root. Serving the raw array would interleave abandoned branches into the
 * transcript. With no active leaf the file is either pre-branching or one Cave
 * declined to linearize, and the stored order is then the only order there is.
 */
export function clientV1ConversationSequence(conversation: ConversationFile): ChatTurn[] {
  const turns = Array.isArray(conversation.turns) ? conversation.turns : [];
  if (!conversation.activeLeafId) return turns;
  return resolveActivePath(turns, conversation.activeLeafId);
}

/**
 * A familiar's page key is its id.
 *
 * Nothing on a roster entry is a timestamp — the record has no createdAt and no
 * updatedAt, and `last_seen` is an opaque daemon string that may be absent. The
 * id is the only field guaranteed present and unique, so it is both the sort
 * key and the tiebreak, which makes the ordering total by construction.
 */
export function clientV1FamiliarPageKey(entry: VisibleFamiliarRosterEntry): ClientV1PageKey {
  return { sort: entry.id, id: entry.id };
}

/**
 * A project's page key is its creation time.
 *
 * `updatedAt` is the more natural "recent projects" order, and it is the wrong
 * key: it moves whenever the project is patched, so a project edited between
 * two page requests jumps in the ordering and is then either served twice or
 * skipped. `createdAt` is required and immutable. This matches the daemon's
 * session pager (OpenCoven/coven#783), which keys on `created_at, id` for the
 * same reason.
 */
export function clientV1ProjectPageKey(project: CaveProject): ClientV1PageKey {
  return { sort: project.createdAt, id: project.id };
}

/**
 * A conversation's page key is its last write.
 *
 * Unlike a project, `createdAt` is *optional* on a ConversationSummary — a
 * transcript written before the field existed has none, and neither does the
 * fallback row a corrupt file produces — so it cannot key the page. `updatedAt`
 * is required, and it is also the order listConversations already sorts by, so
 * a client sees one ordering out of Cave rather than two.
 *
 * The cost is the mutable-key cost above: a conversation that receives a turn
 * mid-pagination moves to the front and can be seen twice. That is visible to
 * the client (the same id in two pages) and recoverable, where the alternative
 * — keying on a field half the corpus lacks — is neither.
 */
export function clientV1ConversationPageKey(summary: ConversationSummary): ClientV1PageKey {
  return { sort: summary.updatedAt, id: summary.sessionId };
}

/**
 * A message's page key.
 *
 * The `sort` half is informational only: messages are paginated by position in
 * the resolved branch, not by comparing keys, because a user turn and the
 * assistant reply answering it are persisted with the *same* createdAt stamp.
 */
export function clientV1MessagePageKey(turn: ChatTurn): ClientV1PageKey {
  return { sort: turn.createdAt, id: turn.id };
}

export function sortClientV1Familiars(
  roster: readonly VisibleFamiliarRosterEntry[],
): VisibleFamiliarRosterEntry[] {
  return [...roster].sort((left, right) =>
    compareClientV1AscendingKeys(clientV1FamiliarPageKey(left), clientV1FamiliarPageKey(right)));
}

export function sortClientV1Projects(projects: readonly CaveProject[]): CaveProject[] {
  return [...projects].sort((left, right) =>
    compareClientV1RecencyKeys(clientV1ProjectPageKey(left), clientV1ProjectPageKey(right)));
}

export function sortClientV1Conversations(
  summaries: readonly ConversationSummary[],
): ConversationSummary[] {
  return [...summaries].sort((left, right) =>
    compareClientV1RecencyKeys(
      clientV1ConversationPageKey(left),
      clientV1ConversationPageKey(right),
    ));
}
