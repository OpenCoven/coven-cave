"use client";

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

type Props = {
  /** Familiar conversation pane — the center column of the Codex layout. */
  chat: ReactNode;
  /** Code pane: the comux surface. In the Code workspace it owns the whole
   *  three-column layout (file tree · conversation · preview/Changes); the chat
   *  is injected as comux's centerSlot. */
  comux: ReactNode;
};

/**
 * Unified Code workspace (mode "code"), styled after the OpenAI Codex layout —
 * three columns side by side: the file-tree explorer (left), the familiar
 * conversation (center), and the working tree (right: the file preview with a
 * Files/Changes toggle to the git diff review).
 *
 * ComuxView owns the three-column layout so the tree and the diff can sit on
 * opposite sides of the conversation from a SINGLE comux instance (no duplicated
 * selection/preview/terminal state); CodeView just feeds the conversation in as
 * comux's `centerSlot`. Every pane stays mounted so chat, terminals, preview, and
 * diff keep their state.
 */
export function CodeView({ chat, comux }: Props) {
  const comuxNode = isValidElement(comux)
    ? cloneElement(comux as ReactElement<Record<string, unknown>>, { centerSlot: chat })
    : comux;

  return (
    <div className="cave-code-page cave-code-page--codex flex min-h-0 min-w-0 flex-1 flex-col" data-code-layout="codex">
      {comuxNode}
    </div>
  );
}
