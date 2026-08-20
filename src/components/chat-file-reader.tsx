"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import { ChatMarkdownReader } from "@/components/chat-markdown-reader";

export type ChatFileReaderTarget = {
  /** Repo-relative path, as resolved against the session's project root. */
  path: string;
  /** Absolute path handed to /api/project-file. */
  absPath: string;
  line?: number;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; markdown: string }
  | { status: "error"; message: string };

function fileName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function errorForStatus(status: number): string {
  if (status === 404) return "The file is no longer at that path.";
  if (status === 403) return "That path sits outside a granted project root.";
  if (status === 413) return "The file is too large to read in chat.";
  return "Cave could not read the file.";
}

/**
 * Opens a project `.md` file in the chat's own Markdown reader (cave chat docs
 * request): a prose ref to a document should read in place, not bounce the
 * reader out to the Code workspace. The Code route stays one click away in the
 * header for editing.
 */
export function ChatFileReader({
  target,
  onClose,
  onOpenUrl,
}: {
  target: ChatFileReaderTarget;
  onClose: () => void;
  onOpenUrl?: (url: string) => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const { path, absPath, line } = target;

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void (async () => {
      try {
        const res = await fetch(
          `/api/project-file?path=${encodeURIComponent(absPath)}`,
          { cache: "no-store" },
        );
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; kind?: string; content?: string; error?: string }
          | null;
        if (cancelled) return;
        if (!res.ok || json?.ok !== true || json.kind !== "text" || typeof json.content !== "string") {
          setState({ status: "error", message: errorForStatus(res.status) });
          return;
        }
        setState({ status: "ready", markdown: json.content });
      } catch {
        if (!cancelled) {
          setState({
            status: "error",
            message: "Cave could not reach the file service.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [absPath]);

  const openInCode = () => {
    window.dispatchEvent(
      new CustomEvent("cave:open-project-file", {
        detail: { path, line },
      }),
    );
    onClose();
  };

  const codeButton = (
    <button
      type="button"
      className="ui-btn ui-btn--ghost ui-btn--sm focus-ring"
      onClick={openInCode}
    >
      <Icon name="ph:code" width={14} aria-hidden />
      Open in Code
    </button>
  );

  return (
    <ChatMarkdownReader
      title={fileName(path)}
      eyebrow="Project document"
      noun="document"
      subject="Document"
      markdown={state.status === "ready" ? state.markdown : null}
      loading={state.status === "loading"}
      error={state.status === "error" ? state.message : null}
      metaPrefix={path}
      fallbackFilename="project-document"
      headerActions={codeButton}
      errorActions={codeButton}
      onClose={onClose}
      onOpenUrl={onOpenUrl}
    />
  );
}
