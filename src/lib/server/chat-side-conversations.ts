import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  conversationDeletionFence, deleteConversation, isSafeConversationSessionId,
  isRetainedSideConversationId,
  activeConversationSendReservations,
  listConversations, loadConversation, saveConversation, withConversationLocks,
  type ChatTurn, type ConversationFile,
} from "../cave-conversations.ts";
import { caveHome } from "../coven-paths.ts";
import { writeJsonAtomic } from "./atomic-write.ts";
import { withProcessIntentLock } from "./process-intent-lock.ts";
import { checkTurnBounds } from "./conversation-write-guards.ts";
import { hasActiveChatRun } from "./chat-stop-registry.ts";

const MAX_TEXT_BYTES = 16 * 1024;
const MAX_REFERENCES = 32;
const OPERATIONS_DIR = path.join(caveHome(), "conversations", ".side-operations");
const PRINCIPAL = "cave-internal-same-user";

export type SideScope = { parentSessionId: string; familiarId: string; projectId: string };
export type BranchExpectation = { revision: string; activeLeafId: string | null };
export type ReviewedExcerpt = {
  schemaVersion: 1;
  kind: "reviewed-excerpt";
  sourceSessionId: string;
  sourceRevision: string;
  sourceTurnIds: string[];
  sourceDigest: string;
  reviewedDigest: string;
  edited: boolean;
  operationId: string;
  inert: true;
};
export type SideCustodyReceipt = {
  caveTranscript: "retained" | "removed";
  execution: "unavailable";
  externalCopies: "not-qualified";
  retainedCopies: "reviewed-imports-and-non-content-operation-records";
  temporary: "unsupported";
};
export type SideOperationReceipt = {
  schemaVersion: 1;
  operationId: string;
  kind: "create" | "close" | "reopen" | "keep-separately" | "discard" | "save-draft" | "bring-back";
  requestDigest: string;
  conversationId: string;
  committedAt: string;
  generation?: number;
  sourceSessionId?: string;
  turnId?: string;
  removed?: boolean;
  custody: SideCustodyReceipt;
};
export type SideConversationRecord = {
  schemaVersion: 1;
  scope: SideScope;
  identity: "unverified-legacy-familiar-link";
  execution: { state: "unavailable"; reason: "identity-context-profile-unavailable" };
  retention: "retained";
  presentation: "open" | "closed";
  keptSeparately: boolean;
  generation: number;
  contextSelection: {
    schemaVersion: 1;
    admitted: false;
    mode: "fresh" | "selected-messages";
    sourceRevision: string;
    sourceActiveLeafId: string | null;
    snapshot: Array<{ turnId: string; role: ChatTurn["role"]; text: string; digest: string }>;
    snapshotDigest: string;
    mandatoryIdentityAndPolicy: "not-admitted";
    optionalMemory: "not-admitted";
    projectResources: "not-admitted";
    attachments: "not-selected";
    toolAccess: "not-granted";
  };
  receipts: SideOperationReceipt[];
};
export type CreateSideInput = {
  operationId: string;
  scope: SideScope;
  expectedParent: BranchExpectation;
  context: { mode: "fresh" | "selected-messages"; turnIds: string[] };
  retention: "retained";
  title?: string;
  draftText?: string;
};
export type SideLifecycleInput = {
  operationId: string;
  scope: SideScope;
  expectedGeneration: number;
  action: "close" | "reopen" | "keep-separately" | "discard" | "save-draft";
  draftText?: string;
};
export type BringBackInput = {
  operationId: string;
  scope: SideScope;
  targetSessionId: string;
  expectedTarget: BranchExpectation;
  expectedSource: BranchExpectation;
  sourceTurnIds: string[];
  reviewedText: string;
};
export class SideConversationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; }
}
function fail(code: string, status = 409): never { throw new SideConversationError(code, status); }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export function sideConversationRevision(conversation: ConversationFile): string {
  return digest(canonical(conversation));
}
export function sideConversationBranch(conversation: ConversationFile): BranchExpectation {
  return { revision: sideConversationRevision(conversation), activeLeafId: conversation.activeLeafId ?? null };
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_request", 400);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !keys.includes(key))) fail("unknown_request_field", 400);
  return result;
}
function token(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) fail(`invalid_${field}`, 400);
  return value;
}
function text(value: unknown, field: string, max = MAX_TEXT_BYTES): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > max || value.includes("\0")) {
    fail(`invalid_${field}`, 400);
  }
  return value;
}
function scope(value: unknown): SideScope {
  const row = record(value, ["parentSessionId", "familiarId", "projectId"]);
  return { parentSessionId: token(row.parentSessionId, "parentSessionId"),
    familiarId: token(row.familiarId, "familiarId"), projectId: token(row.projectId, "projectId") };
}
function branch(value: unknown): BranchExpectation {
  const row = record(value, ["revision", "activeLeafId"]);
  if (typeof row.revision !== "string" || !/^[a-f0-9]{64}$/.test(row.revision)) fail("invalid_revision", 400);
  return { revision: row.revision, activeLeafId: row.activeLeafId === null ? null : token(row.activeLeafId, "activeLeafId") };
}
function references(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_REFERENCES) fail("invalid_source_references", 400);
  const ids = value.map((id) => token(id, "turnId"));
  if (new Set(ids).size !== ids.length) fail("duplicate_source_reference", 400);
  return ids;
}
export function parseCreateSideInput(value: unknown): CreateSideInput {
  const row = record(value, ["operationId", "scope", "expectedParent", "context", "retention", "title", "draftText"]);
  if (row.retention !== "retained") fail("temporary_retention_unsupported", 422);
  const context = record(row.context, ["mode", "turnIds"]);
  if (context.mode !== "fresh" && context.mode !== "selected-messages") fail("context_mode_unsupported", 422);
  const turnIds = references(context.turnIds);
  if ((context.mode === "fresh" && turnIds.length) || (context.mode === "selected-messages" && !turnIds.length)) fail("invalid_context_selection", 400);
  return { operationId: token(row.operationId, "operationId"), scope: scope(row.scope),
    expectedParent: branch(row.expectedParent), context: { mode: context.mode, turnIds }, retention: "retained",
    ...(row.title !== undefined ? { title: text(row.title, "title", 512) } : {}),
    ...(row.draftText !== undefined ? { draftText: text(row.draftText, "draftText") } : {}) };
}
export function parseSideLifecycleInput(value: unknown): SideLifecycleInput {
  const row = record(value, ["operationId", "scope", "expectedGeneration", "action", "draftText"]);
  if (!["close", "reopen", "keep-separately", "discard", "save-draft"].includes(String(row.action))) fail("invalid_action", 400);
  if (!Number.isSafeInteger(row.expectedGeneration) || Number(row.expectedGeneration) < 1) fail("invalid_generation", 400);
  if (row.action !== "save-draft" && row.draftText !== undefined) fail("unexpected_draftText", 400);
  return { operationId: token(row.operationId, "operationId"), scope: scope(row.scope),
    expectedGeneration: Number(row.expectedGeneration), action: row.action as SideLifecycleInput["action"],
    ...(row.action === "save-draft" ? { draftText: text(row.draftText, "draftText") } : {}) };
}
export function parseBringBackInput(value: unknown): BringBackInput {
  const row = record(value, ["operationId", "scope", "targetSessionId", "expectedTarget", "expectedSource", "sourceTurnIds", "reviewedText"]);
  const sourceTurnIds = references(row.sourceTurnIds);
  if (!sourceTurnIds.length) fail("source_references_required", 400);
  return { operationId: token(row.operationId, "operationId"), scope: scope(row.scope),
    targetSessionId: token(row.targetSessionId, "targetSessionId"), expectedTarget: branch(row.expectedTarget),
    expectedSource: branch(row.expectedSource), sourceTurnIds, reviewedText: text(row.reviewedText, "reviewedText") };
}

/** Same-user internal routes only; this is not a Client v1 grant or identity issuer. */
export async function authorizeSideConversationScope(conversation: ConversationFile, expected: SideScope): Promise<void> {
  const [{ loadConfig, loadState }, { loadProjects }, { chatProjectAccessId }, { assertProjectAccess, ProjectAccessDeniedError }] = await Promise.all([
    import("../cave-config.ts"), import("../cave-projects.ts"), import("../chat-project-access.ts"), import("../project-permissions.ts"),
  ]);
  const [config, state, projects] = await Promise.all([loadConfig(), loadState(), loadProjects()]);
  if (state.sessionSacrificed?.[conversation.sessionId]) fail("conversation_deleted", 410);
  if (!Object.hasOwn(config.familiars ?? {}, expected.familiarId) || conversation.familiarId !== expected.familiarId) fail("familiar_scope_mismatch", 403);
  // Legacy records without a recorded local project stay readable by old routes,
  // but cannot acquire a new project linkage from a renderer assertion.
  const cwd = conversation.runtime?.startsWith("local:") ? conversation.runtime.slice(6) : null;
  if (!cwd) fail("project_scope_unverified", 422);
  const projectId = chatProjectAccessId({ projects, resumeCwd: cwd, resolvedCwd: cwd });
  if (!projectId || projectId !== expected.projectId) fail("project_scope_mismatch", 403);
  try { await assertProjectAccess({ familiarId: expected.familiarId }, projectId, "session-launch"); }
  catch (error) {
    if (error instanceof ProjectAccessDeniedError) fail("project_access_denied", 403);
    throw error;
  }
}
type SideDependencies = {
  authorize?: (conversation: ConversationFile, scope: SideScope) => Promise<void>;
};
function custody(removed = false): SideCustodyReceipt {
  return { caveTranscript: removed ? "removed" : "retained", execution: "unavailable",
    externalCopies: "not-qualified", retainedCopies: "reviewed-imports-and-non-content-operation-records", temporary: "unsupported" };
}
type Intent = { requestDigest: string; scope: SideScope; conversationId: string; receipt?: SideOperationReceipt };
function operationKey(operationId: string): string { return digest(`${PRINCIPAL}\0${operationId}`); }
async function readIntent(key: string): Promise<Intent | null> {
  try {
    const value = JSON.parse(await readFile(path.join(OPERATIONS_DIR, `${key}.json`), "utf8")) as Intent;
    if (!value || !/^[a-f0-9]{64}$/.test(value.requestDigest) || !isSafeConversationSessionId(value.conversationId)) fail("operation_record_invalid", 503);
    scope(value.scope);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function writeIntent(key: string, intent: Intent): Promise<void> {
  await mkdir(OPERATIONS_DIR, { recursive: true });
  await writeJsonAtomic(path.join(OPERATIONS_DIR, `${key}.json`), intent);
}
function expectBranch(conversation: ConversationFile, expected: BranchExpectation): void {
  if (sideConversationRevision(conversation) !== expected.revision || (conversation.activeLeafId ?? null) !== expected.activeLeafId) fail("branch_revision_conflict");
}
async function assertImportTargetIdle(conversation: ConversationFile): Promise<void> {
  if (conversation.pendingUserTurnId !== undefined || hasActiveChatRun(conversation.sessionId)
    || (conversation.activeSendReservations !== undefined
      && (!Array.isArray(conversation.activeSendReservations) || conversation.activeSendReservations.length > 0))
    || (await activeConversationSendReservations(conversation.sessionId)).length > 0) {
    fail("target_generation_active");
  }
}
function selectedTurns(conversation: ConversationFile, ids: string[]): ChatTurn[] {
  const byId = new Map(conversation.turns.map((turn) => [turn.id, turn]));
  if (byId.size !== conversation.turns.length) fail("source_branch_invalid");
  if (conversation.turns.length && !conversation.activeLeafId) fail("source_branch_invalid");
  const active: ChatTurn[] = [];
  const seen = new Set<string>();
  let cursor: string | null | undefined = conversation.activeLeafId;
  while (cursor != null) {
    const turn = byId.get(cursor);
    if (!turn || seen.has(cursor)) fail("source_branch_invalid");
    seen.add(cursor);
    active.push(turn);
    cursor = turn.parentId;
  }
  const selected = ids.map((id) => {
    const turn = active.find((entry) => entry.id === id);
    if (!turn || turn.role === "system") fail("source_reference_unavailable");
    return turn;
  });
  if (Buffer.byteLength(selected.map((turn) => turn.text).join("\n"), "utf8") > MAX_TEXT_BYTES) fail("source_selection_too_large", 413);
  return selected;
}
function newReceipt(operationId: string, kind: SideOperationReceipt["kind"], requestDigest: string, conversationId: string): SideOperationReceipt {
  return { schemaVersion: 1, operationId, kind, requestDigest, conversationId, committedAt: new Date().toISOString(), custody: custody(kind === "discard") };
}
function requireSide(conversation: ConversationFile, expected: SideScope): SideConversationRecord {
  const side = conversation.sideConversation;
  if (!side || side.schemaVersion !== 1 || canonical(side.scope) !== canonical(expected)
    || conversation.parentSessionId !== expected.parentSessionId || conversation.familiarId !== expected.familiarId) fail("side_scope_mismatch", 403);
  return side;
}
export async function assertOrdinaryConversationSendAllowed(sessionId: string | null | undefined): Promise<void> {
  if (!sessionId) return;
  if (!isSafeConversationSessionId(sessionId)) fail("invalid_sessionId", 400);
  if (await conversationDeletionFence(sessionId)) fail("conversation_deleted", 410);
  const conversation = await loadConversation(sessionId);
  // Reserved IDs stay fenced even if a partial disk loss removed the JSON.
  if (isRetainedSideConversationId(sessionId) || conversation?.sideConversation) fail("side_execution_unavailable", 422);
}

export function createSideConversationService(dependencies: SideDependencies = {}) {
  const authorize = dependencies.authorize ?? authorizeSideConversationScope;
  async function required(id: string): Promise<ConversationFile> {
    if (await conversationDeletionFence(id)) fail("conversation_deleted", 410);
    const conversation = await loadConversation(id);
    if (!conversation) fail("conversation_not_found", 404);
    return conversation;
  }
  async function parent(expected: SideScope): Promise<ConversationFile> {
    const conversation = await required(expected.parentSessionId);
    if (conversation.sideConversation || conversation.familiarId !== expected.familiarId) fail("parent_scope_mismatch", 403);
    await authorize(conversation, expected);
    return conversation;
  }
  async function transact<T>(
    operationId: string, payload: unknown, expected: SideScope, conversationId: string, ids: string[],
    action: (key: string, intent: Intent, requestDigest: string) => Promise<T>,
  ): Promise<T> {
    const key = operationKey(operationId);
    const requestDigest = digest(canonical({ principal: PRINCIPAL, payload }));
    // Lock operation first, then all transcript fences in lexical order. Deletes
    // acquire only transcript fences, so they cannot invert this ordering.
    return withProcessIntentLock({ intentsDirectory: path.join(OPERATIONS_DIR, ".locks", key), label: "side-operation" }, () =>
      withConversationLocks(ids, async () => {
        await parent(expected);
        const saved = await readIntent(key);
        if (saved && saved.requestDigest !== requestDigest) fail("operation_payload_conflict");
        const intent = saved ?? { requestDigest, scope: expected, conversationId };
        return action(key, intent, requestDigest);
      }));
  }
  return {
    async get(idValue: string, expectedValue: unknown) {
      const id = token(idValue, "sessionId");
      const expected = scope(expectedValue);
      await parent(expected);
      const conversation = await required(id);
      requireSide(conversation, expected);
      await authorize(conversation, expected);
      return { conversation, branch: sideConversationBranch(conversation) };
    },
    async list(expectedValue: unknown, afterValue?: string | null) {
      const expected = scope(expectedValue);
      const after = afterValue == null ? null : token(afterValue, "cursor");
      const conversation = await parent(expected);
      const sides = [];
      let nextCursor: string | null = null;
      const rows = (await listConversations({ includeSideConversations: true })).sort((a, b) => a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0);
      for (const row of rows) {
        if (!row.sideConversation || row.familiarId !== expected.familiarId || (after && row.sessionId <= after)) continue;
        const side = await loadConversation(row.sessionId);
        if (side?.sideConversation && canonical(side.sideConversation.scope) === canonical(expected)) {
          const state = requireSide(side, expected);
          await authorize(side, expected);
          if (sides.length === 50) { nextCursor = sides.at(-1)!.sessionId; break; }
          sides.push({
            sessionId: side.sessionId, title: side.title, createdAt: side.createdAt, updatedAt: side.updatedAt,
            ...sideConversationBranch(side), turnCount: side.turns.length,
            sideConversation: {
              schemaVersion: state.schemaVersion, scope: state.scope, identity: state.identity, execution: state.execution,
              retention: state.retention, presentation: state.presentation, keptSeparately: state.keptSeparately,
              generation: state.generation, contextMode: state.contextSelection.mode, contextAdmitted: false,
            },
          });
        }
      }
      return { parent: { sessionId: conversation.sessionId, ...sideConversationBranch(conversation) }, conversations: sides, nextCursor,
        capabilities: { retainedDrafts: true, execution: false, temporary: false, contextModes: ["fresh", "selected-messages"] } };
    },
    async create(value: unknown) {
      const input = parseCreateSideInput(value);
      const id = `side-${operationKey(input.operationId)}`;
      return transact(input.operationId, { kind: "create", input }, input.scope, id, [id, input.scope.parentSessionId], async (key, intent, requestDigest) => {
        if (await conversationDeletionFence(id)) fail("conversation_deleted", 410);
        const previous = await loadConversation(id);
        if (previous) {
          const side = requireSide(previous, input.scope);
          await authorize(previous, input.scope);
          const receipt = side.receipts.find((entry) => entry.operationId === input.operationId);
          if (receipt?.requestDigest !== requestDigest) fail("operation_payload_conflict");
          return { conversation: previous, receipt };
        }
        const source = await parent(input.scope);
        expectBranch(source, input.expectedParent);
        const snapshot = selectedTurns(source, input.context.turnIds).map((turn) => ({
          turnId: turn.id, role: turn.role, text: turn.text, digest: digest(turn.text),
        }));
        const receipt = newReceipt(input.operationId, "create", requestDigest, id);
        receipt.generation = 1;
        const now = receipt.committedAt;
        const conversation: ConversationFile = {
          sessionId: id, parentSessionId: source.sessionId, familiarId: source.familiarId,
          harness: source.harness, runtime: source.runtime, title: input.title ?? "Retained side draft",
          createdAt: now, updatedAt: now, turns: [],
          sideConversation: {
            schemaVersion: 1, scope: input.scope, identity: "unverified-legacy-familiar-link",
            execution: { state: "unavailable", reason: "identity-context-profile-unavailable" },
            retention: "retained", presentation: "open", keptSeparately: false, generation: 1,
            contextSelection: { schemaVersion: 1, admitted: false, mode: input.context.mode,
              sourceRevision: input.expectedParent.revision, sourceActiveLeafId: input.expectedParent.activeLeafId,
              snapshot, snapshotDigest: digest(canonical(snapshot)), mandatoryIdentityAndPolicy: "not-admitted",
              optionalMemory: "not-admitted", projectResources: "not-admitted", attachments: "not-selected", toolAccess: "not-granted" },
            receipts: [receipt],
          },
        };
        if (input.draftText) {
          const turnId = `draft-${operationKey(input.operationId)}`;
          conversation.turns.push({ id: turnId, role: "user", text: input.draftText, parentId: null, createdAt: now });
          conversation.activeLeafId = turnId;
        }
        await writeIntent(key, intent);
        await saveConversation(conversation, { continuityMutation: true });
        return { conversation, receipt };
      });
    },
    async lifecycle(idValue: string, value: unknown) {
      const id = token(idValue, "sessionId");
      const input = parseSideLifecycleInput(value);
      return transact(input.operationId, { kind: "lifecycle", id, input }, input.scope, id, [id, input.scope.parentSessionId], async (key, intent, requestDigest) => {
        const fence = await conversationDeletionFence(id);
        if (fence) {
          if (input.action !== "discard" || !fence.side || !intent.receipt) fail("conversation_deleted", 410);
          // A crash after the fence but before unlink is completed on retry.
          await deleteConversation(id, { permanent: true });
          return { conversation: null, receipt: intent.receipt };
        }
        const conversation = await required(id);
        const side = requireSide(conversation, input.scope);
        await authorize(conversation, input.scope);
        const previous = side.receipts.find((receipt) => receipt.operationId === input.operationId);
        if (previous) {
          if (previous.requestDigest !== requestDigest) fail("operation_payload_conflict");
          return { conversation, receipt: previous };
        }
        if (side.generation !== input.expectedGeneration) fail("side_generation_conflict");
        const receipt = newReceipt(input.operationId, input.action, requestDigest, id);
        receipt.generation = side.generation + 1;
        if (input.action === "discard") {
          // Non-content intent is durable before deletion; acknowledgement is
          // returned only after unlink. Retry finishes a partially failed unlink.
          await writeIntent(key, { ...intent, receipt });
          await deleteConversation(id, { permanent: true });
          return { conversation: null, receipt };
        }
        if (input.action === "close") side.presentation = "closed";
        if (input.action === "reopen") side.presentation = "open";
        if (input.action === "keep-separately") side.keptSeparately = true;
        if (input.action === "save-draft") {
          if (side.presentation !== "open") fail("side_closed");
          const turnId = `draft-${operationKey(input.operationId)}`;
          conversation.turns.push({ id: turnId, role: "user", text: input.draftText!, createdAt: receipt.committedAt,
            parentId: conversation.activeLeafId ?? null });
          conversation.activeLeafId = turnId;
          const bounds = checkTurnBounds(conversation.turns);
          if (bounds) fail(bounds.error, bounds.status);
          receipt.turnId = turnId;
        }
        side.generation = receipt.generation!;
        side.receipts.push(receipt);
        await writeIntent(key, intent);
        await saveConversation(conversation, { continuityMutation: true });
        return { conversation, receipt };
      });
    },
    async bringBack(idValue: string, value: unknown) {
      const id = token(idValue, "sessionId");
      const input = parseBringBackInput(value);
      if (input.targetSessionId !== input.scope.parentSessionId || input.targetSessionId === id) fail("target_parent_mismatch", 403);
      return transact(input.operationId, { kind: "bring-back", id, input }, input.scope, input.targetSessionId,
        [id, input.targetSessionId], async (key, intent, requestDigest) => {
          // Reconcile under current target authorization before reading source.
          const target = await parent(input.scope);
          const previous = target.sideImportReceipts?.find((entry) => entry.operationId === input.operationId);
          if (previous) {
            if (previous.requestDigest !== requestDigest) fail("operation_payload_conflict");
            return { conversation: target, receipt: previous };
          }
          await assertImportTargetIdle(target);
          const source = await required(id);
          requireSide(source, input.scope);
          await authorize(source, input.scope);
          expectBranch(target, input.expectedTarget);
          selectedTurns(target, []);
          expectBranch(source, input.expectedSource);
          const turns = selectedTurns(source, input.sourceTurnIds);
          const sourceText = turns.map((turn) => turn.text).join("\n\n");
          const receipt = newReceipt(input.operationId, "bring-back", requestDigest, target.sessionId);
          receipt.sourceSessionId = id;
          receipt.turnId = `import-${operationKey(input.operationId)}`;
          const imported: ChatTurn = {
            id: receipt.turnId, parentId: target.activeLeafId ?? null, role: "user",
            text: input.reviewedText, createdAt: receipt.committedAt,
            reviewedExcerpt: { schemaVersion: 1, kind: "reviewed-excerpt", sourceSessionId: id,
              sourceRevision: input.expectedSource.revision, sourceTurnIds: input.sourceTurnIds,
              sourceDigest: digest(sourceText), reviewedDigest: digest(input.reviewedText),
              edited: input.reviewedText !== sourceText, operationId: input.operationId, inert: true },
          };
          target.turns.push(imported);
          target.activeLeafId = imported.id;
          target.sideImportReceipts = [...(target.sideImportReceipts ?? []), receipt];
          const bounds = checkTurnBounds(target.turns);
          if (bounds) fail(bounds.error, bounds.status);
          await writeIntent(key, intent);
          // A run may register while source authorization or intent I/O awaits.
          await assertImportTargetIdle(target);
          // The excerpt and receipt commit in ONE target atomic replacement.
          await saveConversation(target, { continuityMutation: true });
          return { conversation: target, receipt };
        });
    },
  };
}

export const sideConversationService = createSideConversationService();

export async function sideConversationRoute(
  request: Request,
  action: (body: unknown) => Promise<unknown>,
): Promise<Response> {
  try {
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > 64 * 1024) fail("request_too_large", 413);
    const reader = request.body?.getReader();
    if (!reader) fail("invalid_json", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 64 * 1024) { await reader.cancel(); fail("request_too_large", 413); }
      chunks.push(chunk.value);
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { fail("invalid_json", 400); }
    return Response.json({ ok: true, ...await action(body) as object });
  } catch (error) { return sideConversationErrorResponse(error); }
}
export function sideConversationErrorResponse(error: unknown): Response {
  if (error instanceof SideConversationError) {
    return Response.json({ ok: false, code: error.code, error: error.code }, { status: error.status });
  }
  return Response.json({ ok: false, code: "side_storage_unavailable", error: "side_storage_unavailable" }, { status: 503 });
}
