// Where a click on an inline file ref lands. Kept pure and DOM-free so the
// routing decision is unit-testable: the bubble wiring supplies a dispatcher,
// this decides which event to raise and reports where the click went.

import type { FileRef } from "./file-ref.ts";

const MARKDOWN_REF_RE = /\.(?:md|markdown|mdx)$/i;

/** Markdown documents are read, not edited, at the moment they are cited. */
export function isMarkdownRefPath(path: string): boolean {
  return MARKDOWN_REF_RE.test(path);
}

/**
 * Dispatch one event. Mirrors `window.dispatchEvent` semantics: returns false
 * when a listener called preventDefault(), i.e. a surface claimed the open.
 */
export type FileRefDispatch = (
  name: "cave:open-markdown-document" | "cave:open-project-file",
  init: { detail: FileRef; cancelable?: boolean },
) => boolean;

export type FileRefOpenDestination = "chat-reader" | "code-workspace";

/**
 * A `.md` ref is offered to the chat's own reader first, as a cancelable
 * event. A surface that will render the document claims it with
 * preventDefault(); everywhere else — and for every non-markdown ref — the
 * click still lands in the Code workspace, so no surface loses the affordance
 * it already had.
 */
export function openFileRef(
  ref: FileRef,
  dispatch: FileRefDispatch,
): FileRefOpenDestination {
  const detail: FileRef = { path: ref.path, line: ref.line };
  if (isMarkdownRefPath(ref.path)) {
    const claimed = !dispatch("cave:open-markdown-document", {
      detail,
      cancelable: true,
    });
    if (claimed) return "chat-reader";
  }
  dispatch("cave:open-project-file", { detail });
  return "code-workspace";
}

/** Tooltip for the linkified ref — it must name where the click actually goes. */
export function fileRefLinkTitle(ref: FileRef): string {
  if (isMarkdownRefPath(ref.path)) return `Open ${ref.path} in the chat reader`;
  return `Open ${ref.path}${ref.line ? `:${ref.line}` : ""} in the Code workspace`;
}
