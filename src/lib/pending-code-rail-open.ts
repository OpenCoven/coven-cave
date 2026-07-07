export type PendingCodeRailOpen =
  | {
      kind: "files";
      // Omitted for a "browse at root" open (Projects hub → Files): the Files
      // tab shows the tree with nothing selected. Present for a file open.
      path?: string;
      line?: number;
      // When set, the code rail browses THIS project root instead of the active
      // session's — a bounded "peek" that lets the Projects hub drill into any
      // project's files (cave-z44). Cleared on session change / rail collapse.
      root?: string;
      nonce: number;
    }
  | {
      kind: "changes";
      path: string;
      nonce: number;
    };
