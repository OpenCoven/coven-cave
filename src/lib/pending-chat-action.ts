export type PendingChatAction =
  | { kind: "new"; familiarId?: string | null; projectRoot?: string | null; nonce: number }
  | { kind: "open"; sessionId: string; familiarId?: string | null; nonce: number }
  | { kind: "list"; nonce: number }
  | null;
