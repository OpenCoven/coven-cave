export type PendingCodeRailOpen =
  | {
      kind: "files";
      path: string;
      line?: number;
      nonce: number;
    }
  | {
      kind: "changes";
      path: string;
      nonce: number;
    };
