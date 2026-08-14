import type { ConversationFile } from "@/lib/cave-conversations";

export type GatewayInitialStubState =
  | { kind: "created" }
  | { kind: "already-existed" }
  | { kind: "failed-before-exists"; error: unknown };

export type GatewayTranscriptPersistenceDeps = {
  loadConversation: (sessionId: string) => Promise<ConversationFile | null>;
  saveConversation: (conversation: ConversationFile) => Promise<void>;
  withConversationLock: <T>(sessionId: string, operation: () => Promise<T>) => Promise<T>;
};

export async function settleGatewayInitialStub(
  write: Promise<boolean>,
  reportFailure: (error: unknown) => void = (error) => {
    console.warn(
      "[chat] Gateway conversation stub persistence failed; retrying at transcript completion",
      error,
    );
  },
): Promise<GatewayInitialStubState> {
  try {
    return (await write) ? { kind: "created" } : { kind: "already-existed" };
  } catch (error) {
    reportFailure(error);
    return { kind: "failed-before-exists", error };
  }
}

export async function persistGatewayTranscript<Result>(args: {
  sessionId: string;
  initialStubState: GatewayInitialStubState;
  deps: GatewayTranscriptPersistenceDeps;
  createAfterInitialStubFailure: () => ConversationFile;
  complete: (
    conversation: ConversationFile,
    context: { createdAfterInitialStubFailure: boolean },
  ) => Promise<Result> | Result;
}): Promise<Result> {
  return args.deps.withConversationLock(args.sessionId, async () => {
    const existing = await args.deps.loadConversation(args.sessionId);
    const createdAfterInitialStubFailure = existing == null;
    if (
      createdAfterInitialStubFailure
      && args.initialStubState.kind !== "failed-before-exists"
    ) {
      throw new Error("conversation deleted before Gateway transcript save");
    }

    const conversation = existing ?? args.createAfterInitialStubFailure();
    const result = await args.complete(conversation, { createdAfterInitialStubFailure });
    await args.deps.saveConversation(conversation);
    return result;
  });
}
