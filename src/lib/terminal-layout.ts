export type TerminalSession = {
  id: string;
  label: string;
  projectRoot?: string;
};

export type TerminalSplitDirection = "horizontal" | "vertical";
export type TerminalSplitSide = "left" | "right" | "top" | "bottom";

export type TerminalLayoutLeaf = {
  kind: "leaf";
  sessionId: string;
};

export type TerminalLayoutBranch = {
  kind: TerminalSplitDirection;
  children: TerminalLayoutChild[];
};

export type TerminalLayoutChild = {
  size: number;
  node: TerminalLayoutNode;
};

export type TerminalLayoutNode = TerminalLayoutLeaf | TerminalLayoutBranch;

export type TerminalLayoutState = {
  version: 1;
  sessions: TerminalSession[];
  activeSessionId: string | null;
  root: TerminalLayoutNode | null;
};

type AddPlacement = "replace" | "split";

export type AddTerminalSessionOptions = {
  placement?: AddPlacement;
  targetSessionId?: string;
  side?: TerminalSplitSide;
};

export type SplitTerminalPaneOptions = {
  sourceSessionId: string;
  targetSessionId: string;
  side: TerminalSplitSide;
};

function uniqueSessions(sessions: TerminalSession[]): TerminalSession[] {
  const seen = new Set<string>();
  const next: TerminalSession[] = [];
  for (const session of sessions) {
    if (!session.id || seen.has(session.id)) continue;
    seen.add(session.id);
    next.push(session);
  }
  return next;
}

function directionForSide(side: TerminalSplitSide): TerminalSplitDirection {
  return side === "left" || side === "right" ? "horizontal" : "vertical";
}

function sourceFirst(side: TerminalSplitSide): boolean {
  return side === "left" || side === "top";
}

function equalize(children: TerminalLayoutChild[]): TerminalLayoutChild[] {
  const size = children.length > 0 ? 100 / children.length : 100;
  return children.map((child) => ({ ...child, size }));
}

function child(node: TerminalLayoutNode): TerminalLayoutChild {
  return { size: 100, node };
}

function visibleIds(node: TerminalLayoutNode | null): string[] {
  if (!node) return [];
  if (node.kind === "leaf") return [node.sessionId];
  return node.children.flatMap((entry) => visibleIds(entry.node));
}

function containsSession(node: TerminalLayoutNode | null, sessionId: string): boolean {
  return visibleIds(node).includes(sessionId);
}

function nodeReferencesKnownSessions(
  node: TerminalLayoutNode | null,
  sessionIds: Set<string>,
): boolean {
  if (!node) return true;
  if (node.kind === "leaf") return sessionIds.has(node.sessionId);
  return node.children.every((entry) => nodeReferencesKnownSessions(entry.node, sessionIds));
}

function collapse(node: TerminalLayoutNode | null): TerminalLayoutNode | null {
  if (!node || node.kind === "leaf") return node;
  const children = equalize(
    node.children
      .map((entry) => collapse(entry.node))
      .filter((entry): entry is TerminalLayoutNode => entry !== null)
      .map((entry) => child(entry)),
  );
  if (children.length === 0) return null;
  if (children.length === 1) return children[0].node;
  return { ...node, children };
}

function removeLeaf(
  node: TerminalLayoutNode | null,
  sessionId: string,
): { node: TerminalLayoutNode | null; removed: boolean } {
  if (!node) return { node: null, removed: false };
  if (node.kind === "leaf") {
    return node.sessionId === sessionId
      ? { node: null, removed: true }
      : { node, removed: false };
  }

  let removed = false;
  const children: TerminalLayoutChild[] = [];
  for (const entry of node.children) {
    const next = removeLeaf(entry.node, sessionId);
    removed ||= next.removed;
    if (next.node) children.push({ ...entry, node: next.node });
  }

  return {
    node: collapse({ ...node, children }),
    removed,
  };
}

function insertNear(
  node: TerminalLayoutNode | null,
  targetSessionId: string,
  sourceSessionId: string,
  side: TerminalSplitSide,
): { node: TerminalLayoutNode | null; inserted: boolean } {
  if (!node) {
    return { node: { kind: "leaf", sessionId: sourceSessionId }, inserted: true };
  }

  const direction = directionForSide(side);
  const source = child({ kind: "leaf", sessionId: sourceSessionId });
  if (node.kind === "leaf") {
    if (node.sessionId !== targetSessionId) {
      return { node, inserted: false };
    }
    const target = child(node);
    return {
      node: {
        kind: direction,
        children: equalize(sourceFirst(side) ? [source, target] : [target, source]),
      },
      inserted: true,
    };
  }

  const directTargetIdx = node.children.findIndex(
    (entry) => entry.node.kind === "leaf" && entry.node.sessionId === targetSessionId,
  );
  if (node.kind === direction && directTargetIdx >= 0) {
    const children = [...node.children];
    children.splice(sourceFirst(side) ? directTargetIdx : directTargetIdx + 1, 0, source);
    return {
      node: { ...node, children: equalize(children) },
      inserted: true,
    };
  }

  let inserted = false;
  const children = node.children.map((entry) => {
    if (inserted) return entry;
    const next = insertNear(entry.node, targetSessionId, sourceSessionId, side);
    inserted = next.inserted;
    return next.node ? { ...entry, node: next.node } : entry;
  });

  return {
    node: { ...node, children: equalize(children) },
    inserted,
  };
}

function replaceLeaf(
  node: TerminalLayoutNode | null,
  targetSessionId: string,
  nextSessionId: string,
): { node: TerminalLayoutNode | null; replaced: boolean } {
  if (!node) {
    return { node: { kind: "leaf", sessionId: nextSessionId }, replaced: true };
  }
  if (node.kind === "leaf") {
    return node.sessionId === targetSessionId
      ? { node: { kind: "leaf", sessionId: nextSessionId }, replaced: true }
      : { node, replaced: false };
  }

  let replaced = false;
  const children = node.children.map((entry) => {
    if (replaced) return entry;
    const next = replaceLeaf(entry.node, targetSessionId, nextSessionId);
    replaced = next.replaced;
    return next.node ? { ...entry, node: next.node } : entry;
  });

  return { node: { ...node, children: equalize(children) }, replaced };
}

function firstVisible(state: TerminalLayoutState): string | null {
  return terminalLayoutVisibleSessionIds(state)[0] ?? null;
}

function withActiveFallback(state: TerminalLayoutState): TerminalLayoutState {
  return normalizeTerminalLayout(state);
}

export function createTerminalLayout(
  sessions: TerminalSession[] = [],
  activeSessionId?: string | null,
): TerminalLayoutState {
  const unique = uniqueSessions(sessions);
  const active =
    activeSessionId && unique.some((session) => session.id === activeSessionId)
      ? activeSessionId
      : unique[0]?.id ?? null;
  return {
    version: 1,
    sessions: unique,
    activeSessionId: active,
    root: active ? { kind: "leaf", sessionId: active } : null,
  };
}

export function normalizeTerminalLayout(state: TerminalLayoutState): TerminalLayoutState {
  const sessions = uniqueSessions(state.sessions);
  const sessionIds = new Set(sessions.map((session) => session.id));
  const requestedActive =
    state.activeSessionId && sessionIds.has(state.activeSessionId)
      ? state.activeSessionId
      : null;
  const root = nodeReferencesKnownSessions(state.root, sessionIds)
    ? state.root
    : null;
  const hydratedRoot =
    root ?? (sessions.length > 0
      ? { kind: "leaf", sessionId: requestedActive ?? sessions[0].id }
      : null);
  const visible = visibleIds(hydratedRoot).filter((id, index, ids) => ids.indexOf(id) === index);
  return {
    version: 1,
    sessions,
    root: hydratedRoot,
    activeSessionId:
      requestedActive && visible.includes(requestedActive)
        ? requestedActive
        : visible[0] ?? null,
  };
}

export function terminalLayoutSessionIds(state: TerminalLayoutState): string[] {
  return state.sessions.map((session) => session.id);
}

export function terminalLayoutVisibleSessionIds(state: TerminalLayoutState): string[] {
  return visibleIds(state.root).filter((id, index, ids) => ids.indexOf(id) === index);
}

export function reorderTerminalSessions(
  state: TerminalLayoutState,
  sourceSessionId: string,
  targetSessionId: string,
): TerminalLayoutState {
  if (sourceSessionId === targetSessionId) return state;
  const sourceIndex = state.sessions.findIndex((session) => session.id === sourceSessionId);
  const targetIndex = state.sessions.findIndex((session) => session.id === targetSessionId);
  if (sourceIndex < 0 || targetIndex < 0) return state;

  const sessions = [...state.sessions];
  const [source] = sessions.splice(sourceIndex, 1);
  const nextTargetIndex = sessions.findIndex((session) => session.id === targetSessionId);
  sessions.splice(nextTargetIndex, 0, source);
  return { ...state, sessions };
}

export function addTerminalSession(
  state: TerminalLayoutState,
  session: TerminalSession,
  options: AddTerminalSessionOptions = {},
): TerminalLayoutState {
  const sessions = uniqueSessions([...state.sessions.filter((item) => item.id !== session.id), session]);
  const seeded: TerminalLayoutState = { ...state, sessions };
  const targetSessionId = options.targetSessionId ?? state.activeSessionId ?? firstVisible(seeded);

  if (options.placement === "split" && targetSessionId) {
    return splitTerminalPane(
      { ...seeded, activeSessionId: session.id },
      {
        sourceSessionId: session.id,
        targetSessionId,
        side: options.side ?? "right",
      },
    );
  }

  const target = targetSessionId ?? terminalLayoutVisibleSessionIds(seeded)[0] ?? session.id;
  const replaced = replaceLeaf(seeded.root, target, session.id);
  return {
    ...seeded,
    root: replaced.node,
    activeSessionId: session.id,
  };
}

export function splitTerminalPane(
  state: TerminalLayoutState,
  options: SplitTerminalPaneOptions,
): TerminalLayoutState {
  const { sourceSessionId, targetSessionId, side } = options;
  if (sourceSessionId === targetSessionId) return state;
  if (!state.sessions.some((session) => session.id === sourceSessionId)) return state;
  if (!state.sessions.some((session) => session.id === targetSessionId)) return state;

  const withoutSource = removeLeaf(state.root, sourceSessionId).node;
  const root = withoutSource ?? { kind: "leaf", sessionId: targetSessionId };
  const inserted = insertNear(root, targetSessionId, sourceSessionId, side);
  return {
    ...state,
    root: inserted.inserted ? inserted.node : root,
    activeSessionId: sourceSessionId,
  };
}

export function moveTerminalPane(
  state: TerminalLayoutState,
  options: SplitTerminalPaneOptions,
): TerminalLayoutState {
  return splitTerminalPane(state, options);
}

export function removeTerminalPaneView(
  state: TerminalLayoutState,
  sessionId: string,
): TerminalLayoutState {
  const removed = removeLeaf(state.root, sessionId);
  if (!removed.removed) return state;
  return withActiveFallback({
    ...state,
    root: removed.node,
  });
}

export function closeTerminalSession(
  state: TerminalLayoutState,
  sessionId: string,
): TerminalLayoutState {
  const removed = removeLeaf(state.root, sessionId);
  return withActiveFallback({
    ...state,
    sessions: state.sessions.filter((session) => session.id !== sessionId),
    root: removed.node,
    activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
  });
}

export function focusTerminalSession(
  state: TerminalLayoutState,
  sessionId: string,
): TerminalLayoutState {
  if (!state.sessions.some((session) => session.id === sessionId)) return state;
  if (containsSession(state.root, sessionId)) {
    return { ...state, activeSessionId: sessionId };
  }
  const target = state.activeSessionId ?? firstVisible(state);
  const root: TerminalLayoutNode | null = target
    ? replaceLeaf(state.root, target, sessionId).node
    : { kind: "leaf", sessionId };
  return {
    ...state,
    root,
    activeSessionId: sessionId,
  };
}

export function renameTerminalSession(
  state: TerminalLayoutState,
  sessionId: string,
  label: string,
): TerminalLayoutState {
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === sessionId ? { ...session, label } : session,
    ),
  };
}
