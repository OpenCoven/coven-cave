export type TerminalPaneNode = {
  kind: "pane";
  id: string;
  label: string;
};

export type TerminalSplitNode = {
  kind: "split";
  id: string;
  direction: "horizontal" | "vertical";
  first: TerminalLayoutNode;
  second: TerminalLayoutNode;
};

export type TerminalLayoutNode = TerminalPaneNode | TerminalSplitNode;

export type TerminalLayout = {
  root: TerminalLayoutNode;
  nextPaneNumber: number;
};

const MAX_TERMINAL_PANES = 4;

function pane(number: number): TerminalPaneNode {
  return {
    kind: "pane",
    id: `terminal-${number}`,
    label: `Terminal ${number}`,
  };
}

export function createTerminalLayout(): TerminalLayout {
  return { root: pane(1), nextPaneNumber: 2 };
}

export function terminalPaneIds(node: TerminalLayoutNode): string[] {
  if (node.kind === "pane") return [node.id];
  return [...terminalPaneIds(node.first), ...terminalPaneIds(node.second)];
}

export function terminalPaneCount(node: TerminalLayoutNode): number {
  return terminalPaneIds(node).length;
}

function replacePane(
  node: TerminalLayoutNode,
  targetId: string,
  replacement: (target: TerminalPaneNode) => TerminalLayoutNode,
): TerminalLayoutNode {
  if (node.kind === "pane") return node.id === targetId ? replacement(node) : node;
  const first = replacePane(node.first, targetId, replacement);
  const second = replacePane(node.second, targetId, replacement);
  if (first === node.first && second === node.second) return node;
  return { ...node, first, second };
}

export function splitTerminalPane(
  layout: TerminalLayout,
  targetId: string,
  direction: TerminalSplitNode["direction"],
): TerminalLayout {
  if (terminalPaneCount(layout.root) >= MAX_TERMINAL_PANES) return layout;
  const nextPane = pane(layout.nextPaneNumber);
  const root = replacePane(layout.root, targetId, (target) => ({
    kind: "split",
    id: `split-${target.id}-${nextPane.id}`,
    direction,
    first: target,
    second: nextPane,
  }));
  if (root === layout.root) return layout;
  return { root, nextPaneNumber: layout.nextPaneNumber + 1 };
}

function removePane(node: TerminalLayoutNode, targetId: string): TerminalLayoutNode | null {
  if (node.kind === "pane") return node.id === targetId ? null : node;
  const first = removePane(node.first, targetId);
  const second = removePane(node.second, targetId);
  if (first === null) return second;
  if (second === null) return first;
  if (first === node.first && second === node.second) return node;
  return { ...node, first, second };
}

export function closeTerminalPane(layout: TerminalLayout, targetId: string): TerminalLayout {
  if (terminalPaneCount(layout.root) === 1) return layout;
  const root = removePane(layout.root, targetId);
  if (!root || root === layout.root) return layout;
  return { ...layout, root };
}

export function terminalThreadId(sessionId: string, paneId: string): string {
  return paneId === "terminal-1"
    ? `cave.rail.${sessionId}`
    : `cave.code.${sessionId}.${paneId}`;
}
