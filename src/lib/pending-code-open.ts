export type PendingCodeOpen =
  | {
      kind: "files";
      // Omitted for a "browse at root" open (Projects hub → Files): the Files
      // tab shows the tree with nothing selected. Present for a file open.
      path?: string;
      line?: number;
      // When set, the target browses THIS project root instead of the active
      // session's — a bounded "peek" that lets the Projects hub drill into any
      // project's files (cave-z44).
      root?: string;
      // The chat session the open was raised from (cave-ohcj): the Code
      // surface selects this session's workbench so the file lands beside the
      // conversation's diff/terminal context. Absent for root-only browses.
      sessionId?: string;
      nonce: number;
    }
  | {
      kind: "changes";
      path: string;
      sessionId?: string;
      nonce: number;
    };
