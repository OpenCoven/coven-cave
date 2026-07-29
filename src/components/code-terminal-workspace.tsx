"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { BottomTerminal } from "@/components/bottom-terminal";
import { IconButton } from "@/components/ui/icon-button";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { PopoverItem, PopoverLabel } from "@/components/ui/popover";
import { SeparatorHandle } from "@/components/ui/separator-handle";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  closeTerminalPane,
  createTerminalLayout,
  splitTerminalPane,
  terminalPaneCount,
  terminalPaneIds,
  terminalThreadId,
  type TerminalLayoutNode,
  type TerminalPaneNode,
} from "@/lib/code-terminal-layout";
import { broadcastTargetIds } from "@/lib/terminal-broadcast";

type TerminalWriter = (data: string) => void;

type TerminalNodeProps = {
  node: TerminalLayoutNode;
  sessionId: string;
  projectRoot: string;
  focusedPaneId: string;
  onFocus: (paneId: string) => void;
  registerWriter: (paneId: string, write: TerminalWriter | null) => void;
  onUserInput: (paneId: string, data: string) => void;
};

function TerminalPane({
  node,
  sessionId,
  projectRoot,
  focusedPaneId,
  onFocus,
  registerWriter,
  onUserInput,
}: Omit<TerminalNodeProps, "node"> & { node: TerminalPaneNode }) {
  const focused = focusedPaneId === node.id;
  return (
    <section
      aria-label={node.label}
      className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--code-surface)]"
      data-focused={focused || undefined}
      onFocusCapture={() => onFocus(node.id)}
      onPointerDownCapture={() => onFocus(node.id)}
    >
      <div
        className={`flex shrink-0 items-center justify-between border-b px-2 py-1 font-mono text-[length:var(--text-2xs)] ${
          focused
            ? "border-[var(--accent-presence)] text-[var(--text-primary)]"
            : "border-[var(--border-hairline)] text-[var(--text-muted)]"
        }`}
      >
        <span>{node.label}</span>
        <span>{focused ? "Focused" : "Ready"}</span>
      </div>
      <div className="min-h-0 flex-1">
        <BottomTerminal
          threadId={terminalThreadId(sessionId, node.id)}
          projectRoot={projectRoot}
          paneId={node.id}
          label={node.label}
          active={focusedPaneId === node.id}
          visible
          registerWriter={registerWriter}
          onUserInput={onUserInput}
        />
      </div>
    </section>
  );
}

function TerminalNode(props: TerminalNodeProps) {
  const { node } = props;
  if (node.kind === "pane") return <TerminalPane {...props} node={node} />;
  const separatorOrientation = node.direction === "horizontal" ? "col" : "row";
  const minSize = node.direction === "horizontal" ? "240px" : "140px";
  return (
    <Group
      className="min-h-0 min-w-0"
      orientation={node.direction}
    >
      <Panel id={`${node.id}-first`} minSize={minSize} className="min-h-0 min-w-0">
        <TerminalNode {...props} node={node.first} />
      </Panel>
      <Separator className="shell-separator">
        <SeparatorHandle orientation={separatorOrientation} />
      </Separator>
      <Panel id={`${node.id}-second`} minSize={minSize} className="min-h-0 min-w-0">
        <TerminalNode {...props} node={node.second} />
      </Panel>
    </Group>
  );
}

export function CodeTerminalWorkspace({
  sessionId,
  projectRoot,
  allowSplits = true,
}: {
  sessionId: string;
  projectRoot: string;
  allowSplits?: boolean;
}) {
  const { announce } = useAnnouncer();
  const [layout, setLayout] = useState(createTerminalLayout);
  const [focusedPaneId, setFocusedPaneId] = useState("terminal-1");
  const [broadcastInput, setBroadcastInput] = useState(false);
  const writersRef = useRef(new Map<string, TerminalWriter>());

  useEffect(() => {
    setLayout(createTerminalLayout());
    setFocusedPaneId("terminal-1");
    setBroadcastInput(false);
    writersRef.current.clear();
  }, [sessionId]);

  const registerWriter = useCallback((paneId: string, write: TerminalWriter | null) => {
    if (write) writersRef.current.set(paneId, write);
    else writersRef.current.delete(paneId);
  }, []);

  const onUserInput = useCallback((paneId: string, data: string) => {
    if (!broadcastInput) return;
    const targets = broadcastTargetIds(terminalPaneIds(layout.root), paneId);
    for (const targetId of targets) writersRef.current.get(targetId)?.(data);
  }, [broadcastInput, layout.root]);

  const splitFocused = (direction: "horizontal" | "vertical") => {
    const next = splitTerminalPane(layout, focusedPaneId, direction);
    if (next === layout) return;
    const nextIds = terminalPaneIds(next.root);
    const addedId = nextIds[nextIds.length - 1]!;
    setLayout(next);
    setFocusedPaneId(addedId);
    announce(`${direction === "horizontal" ? "Right" : "Lower"} terminal pane opened.`);
  };

  const closeFocused = () => {
    const currentIds = terminalPaneIds(layout.root);
    const currentIndex = currentIds.indexOf(focusedPaneId);
    const next = closeTerminalPane(layout, focusedPaneId);
    if (next === layout) return;
    const nextIds = terminalPaneIds(next.root);
    setLayout(next);
    setFocusedPaneId(nextIds[Math.min(Math.max(currentIndex, 0), nextIds.length - 1)]!);
    announce("Terminal pane closed.");
  };

  const atPaneLimit = terminalPaneCount(layout.root) >= 4;
  const splittingDisabled = !allowSplits || atPaneLimit;

  return (
    <section aria-label="Terminal workspace" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--bg-panel)] px-2 py-1">
        <div className="min-w-0">
          <div className="text-[length:var(--text-xs)] font-semibold text-[var(--text-primary)]">
            Terminal workspace
          </div>
          <div className="truncate font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]">
            {terminalPaneCount(layout.root)} pane{terminalPaneCount(layout.root) === 1 ? "" : "s"} · {projectRoot}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            icon="ph:columns"
            size="sm"
            className="focus-ring"
            aria-label="Split terminal right"
            title={!allowSplits ? "Terminal splitting needs a wider workspace" : atPaneLimit ? "Four terminal panes are already open" : "Split terminal right"}
            disabled={splittingDisabled}
            onClick={() => splitFocused("horizontal")}
          />
          <IconButton
            icon="ph:rows"
            size="sm"
            className="focus-ring"
            aria-label="Split terminal down"
            title={!allowSplits ? "Terminal splitting needs a wider workspace" : atPaneLimit ? "Four terminal panes are already open" : "Split terminal down"}
            disabled={splittingDisabled}
            onClick={() => splitFocused("vertical")}
          />
          <IconButton
            icon="ph:x-bold"
            size="sm"
            className="focus-ring"
            aria-label="Close terminal"
            title={terminalPaneCount(layout.root) === 1 ? "The last terminal stays open" : "Close terminal"}
            disabled={terminalPaneCount(layout.root) === 1}
            onClick={closeFocused}
          />
          <OverflowMenu ariaLabel="More terminal actions" size="sm">
            <PopoverLabel>Terminal panes</PopoverLabel>
            <PopoverItem
              active={broadcastInput}
              onSelect={() => {
                const next = !broadcastInput;
                setBroadcastInput(next);
                announce(`Broadcast input ${next ? "on" : "off"}.`);
              }}
              title="Mirror typing from the focused terminal to every other open terminal"
            >
              {broadcastInput ? "Turn broadcast input off" : "Broadcast input"}
            </PopoverItem>
          </OverflowMenu>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <TerminalNode
          node={layout.root}
          sessionId={sessionId}
          projectRoot={projectRoot}
          focusedPaneId={focusedPaneId}
          onFocus={setFocusedPaneId}
          registerWriter={registerWriter}
          onUserInput={onUserInput}
        />
      </div>
    </section>
  );
}
