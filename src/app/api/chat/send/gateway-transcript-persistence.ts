import type { ConversationFile } from "@/lib/cave-conversations";

export type GatewayInitialStubState =
  | { kind: "created"; deletionGeneration: number | null }
  | { kind: "already-existed"; deletionGeneration: number | null }
  | { kind: "failed-before-exists"; error: unknown; deletionGeneration: number | null };

export type GatewayTranscriptPersistenceDeps = {
  loadConversation: (sessionId: string) => Promise<ConversationFile | null>;
  saveConversation: (conversation: ConversationFile) => Promise<void>;
  withConversationLock: <T>(sessionId: string, operation: () => Promise<T>) => Promise<T>;
  getDeletionGeneration: (sessionId: string) => Promise<number>;
};

export async function settleGatewayInitialStub(
  write: Promise<boolean>,
  deletionGeneration: () => number | null,
  reportFailure: (error: unknown) => void = (error) => {
    console.warn(
      "[chat] Gateway conversation stub persistence failed; retrying at transcript completion",
      error,
    );
  },
): Promise<GatewayInitialStubState> {
  try {
    return (await write)
      ? { kind: "created", deletionGeneration: deletionGeneration() }
      : { kind: "already-existed", deletionGeneration: deletionGeneration() };
  } catch (error) {
    reportFailure(error);
    return { kind: "failed-before-exists", error, deletionGeneration: deletionGeneration() };
  }
}

export async function persistGatewayTranscript<Result>(args: {
  sessionId: string;
  initialStubState: GatewayInitialStubState;
  /**
   * client-v1 records this while authorization owns the conversation fence.
   * Legacy chat omits it and retains its established missing-stub recovery.
   */
  expectedDeletionGeneration?: number;
  deps: GatewayTranscriptPersistenceDeps;
  createAfterInitialStubFailure: () => ConversationFile;
  complete: (
    conversation: ConversationFile,
    context: { createdAfterInitialStubFailure: boolean },
  ) => Promise<Result> | Result;
}): Promise<Result> {
  return args.deps.withConversationLock(args.sessionId, async () => {
    const deletionGeneration = await args.deps.getDeletionGeneration(args.sessionId);
    if (
      args.expectedDeletionGeneration !== undefined
      && deletionGeneration !== args.expectedDeletionGeneration
    ) {
      throw new Error("conversation deleted before Gateway transcript save");
    }
    const existing = await args.deps.loadConversation(args.sessionId);
    const createdAfterInitialStubFailure = existing == null;
    if (
      createdAfterInitialStubFailure
      && (
        args.initialStubState.kind !== "failed-before-exists"
        || args.initialStubState.deletionGeneration == null
        || args.initialStubState.deletionGeneration !== await args.deps.getDeletionGeneration(args.sessionId)
      )
    ) {
      throw new Error("conversation deleted before Gateway transcript save");
    }

    const conversation = existing ?? args.createAfterInitialStubFailure();
    const result = await args.complete(conversation, { createdAfterInitialStubFailure });
    // This is immediately before this helper's only save. The enclosing
    // conversation fence serializes DELETE in-process and cross-process.
    if (
      args.expectedDeletionGeneration !== undefined
      && args.expectedDeletionGeneration !== await args.deps.getDeletionGeneration(args.sessionId)
    ) {
      throw new Error("conversation deleted before Gateway transcript save");
    }
    await args.deps.saveConversation(conversation);
    return result;
  });
}
