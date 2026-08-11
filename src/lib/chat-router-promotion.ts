export type ChatSessionPromotionRequest = {
  newSessionId: string;
  expectedSessionId: string | null;
  composeInstance: number;
};

type ChatRouterPromotionState = {
  sessionId: string | null;
  composeInstance: number;
};

export function shouldRouterPromoteSession(
  current: ChatRouterPromotionState,
  request: ChatSessionPromotionRequest,
): boolean {
  return current.sessionId === request.expectedSessionId
    && current.composeInstance === request.composeInstance;
}
