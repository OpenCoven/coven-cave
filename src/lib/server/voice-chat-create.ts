// Voice new-chat: pre-create an EMPTY conversation file so a voice call can
// attach to a brand-new session from turn zero. This exists because
// appendTurn (cave-conversations.ts) silently drops transcript turns when the
// conversation file is missing — a call minted against a bare session id
// would lose its transcript. Deps are injected so tests stay hermetic
// (same pattern as daemon-update-lifecycle.ts).

import {
  bindingFor,
  initializeSessionTitleOwnership,
  loadConfig,
  recordSessionFamiliar,
  type CaveConfig,
} from "../cave-config.ts";
import { saveConversation, type ConversationFile } from "../cave-conversations.ts";
import { defaultChatTitleForSession } from "../cave-chat-titles.ts";

export type VoiceChatCreateDeps = {
  /** null when the familiar does not exist. */
  loadFamiliarBinding(familiarId: string): Promise<{ harness: string } | null>;
  saveConversation(conv: ConversationFile): Promise<void>;
  recordSessionFamiliar(sessionId: string, familiarId: string): Promise<void>;
  initializeSessionTitleOwnership(sessionId: string, title: string): Promise<void>;
  defaultTitle(sessionId: string): string;
  /** Override for tests; defaults to crypto.randomUUID. */
  mintSessionId?: () => string;
};

export type VoiceChatCreateResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: "familiar_not_found" | "save_failed" };

export async function createVoiceChatSession(
  deps: VoiceChatCreateDeps,
  input: { familiarId: string; projectRoot: string | null },
): Promise<VoiceChatCreateResult> {
  const binding = await deps.loadFamiliarBinding(input.familiarId);
  if (!binding) return { ok: false, error: "familiar_not_found" };

  const sessionId = (deps.mintSessionId ?? (() => crypto.randomUUID()))();
  const now = new Date().toISOString();
  const conv: ConversationFile = {
    sessionId,
    familiarId: input.familiarId,
    harness: binding.harness,
    // Provenance: this session was born for a voice call, not a typed chat.
    origin: "call",
    // chat/send reads the conversation cwd from `runtime: "local:<cwd>"`.
    ...(input.projectRoot ? { runtime: `local:${input.projectRoot}` } : {}),
    // Independent from execution runtime: property presence records that this
    // creator authoritatively decided either a root or explicit projectless.
    projectRoot: input.projectRoot,
    createdAt: now,
    updatedAt: now,
    turns: [],
  };

  try {
    await deps.saveConversation(conv);
    await deps.recordSessionFamiliar(sessionId, input.familiarId);
    await deps.initializeSessionTitleOwnership(sessionId, deps.defaultTitle(sessionId));
  } catch {
    return { ok: false, error: "save_failed" };
  }
  return { ok: true, sessionId };
}

/**
 * The production `VoiceChatCreateDeps` wiring for `createVoiceChatSession`,
 * reusing the exact same binding lookup / save / title-ownership primitives
 * the legacy `/api/chat/conversation/route.ts` voice new-chat route wires
 * inline. Used by the `/api/client/v1/conversations` facade
 * (`@/lib/server/client-v1/chat-service.ts`) so both callers delegate to the
 * SAME `createVoiceChatSession` domain function with the SAME dependency
 * shape — never a forked reimplementation.
 *
 * The legacy route intentionally keeps its own inline `deps` literal rather
 * than importing this factory: its `route.test.ts` asserts on route.ts's own
 * source text (e.g. that `initializeSessionTitleOwnership` — not
 * `setSessionTitleAuto`/`setSessionTitle` — is the one wired for its
 * generated default title). Swapping that literal for a factory call would
 * make those source-contract assertions blind to a real regression, so this
 * export exists as the reusable wiring for NEW callers without touching the
 * legacy route's file contents.
 */
export function createDefaultVoiceChatCreateDeps(): VoiceChatCreateDeps {
  return {
    loadFamiliarBinding: async (familiarId) => {
      const config = await loadConfig();
      if (!Object.hasOwn(config.familiars ?? {}, familiarId)) return null;
      const binding = bindingFor(config, familiarId);
      return { harness: binding.harness };
    },
    saveConversation,
    recordSessionFamiliar,
    initializeSessionTitleOwnership: async (sessionId, title) => {
      await initializeSessionTitleOwnership(sessionId, title);
    },
    defaultTitle: (sessionId) => defaultChatTitleForSession(sessionId),
  };
}

/**
 * Same production wiring as `createDefaultVoiceChatCreateDeps`, except
 * `loadFamiliarBinding` resolves against an ALREADY-LOADED `config` snapshot
 * instead of calling `loadConfig()` fresh (cave-client-v1 plan Task 7
 * followup). `@/lib/server/client-v1/chat-service.ts`'s
 * create/patch/delete now run their whole effect inside
 * `withFamiliarLifecycleGuard` (@/lib/cave-config.ts), which hands its
 * callback a preloaded `CaveConfig` and documents that the callback must
 * NEVER call `loadConfig`/`saveConfig` again (that would try to reacquire
 * the SAME dedicated lock the guard is already holding — a deadlock). This
 * factory lets `createVoiceChatSession`'s binding lookup honor that rule
 * while still resolving the exact same binding shape
 * (`{ harness: string } | null`) `createDefaultVoiceChatCreateDeps` does.
 */
export function createVoiceChatCreateDepsFromConfig(config: CaveConfig): VoiceChatCreateDeps {
  return {
    loadFamiliarBinding: async (familiarId) => {
      if (!Object.hasOwn(config.familiars ?? {}, familiarId)) return null;
      const binding = bindingFor(config, familiarId);
      return { harness: binding.harness };
    },
    saveConversation,
    recordSessionFamiliar,
    initializeSessionTitleOwnership: async (sessionId, title) => {
      await initializeSessionTitleOwnership(sessionId, title);
    },
    defaultTitle: (sessionId) => defaultChatTitleForSession(sessionId),
  };
}
