"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BottomTerminal } from "@/components/bottom-terminal";
import { ProjectTree, type ProjectTreeHandle } from "@/components/project-tree";
import { SyntaxBlock } from "@/components/message-bubble";

type ComuxTab = "comux" | "project";

type Session = {
  id: string;
  label: string;
};

const STORAGE_TAB = "cave:comux:tab";
const STORAGE_SESSIONS = "cave:comux:sessions";

function readTab(): ComuxTab {
  if (typeof window === "undefined") return "comux";
  const v = window.localStorage.getItem(STORAGE_TAB);
  return v === "project" ? "project" : "comux";
}

function readSessions(): Session[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_SESSIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is Session =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as Record<string, unknown>).id === "string" &&
        typeof (s as Record<string, unknown>).label === "string",
    );
  } catch {
    return [];
  }
}

function uid(): string {
  return crypto.randomUUID();
}

export function ComuxView() {
  const [tab, setTab] = useState<ComuxTab>(readTab);
  const [sessions, setSessions] = useState<Session[]>(readSessions);
  const [currentIdx, setCurrentIdx] = useState(0);

  // Project tab state
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const treeRef = useRef<ProjectTreeHandle | null>(null);

  // Persist tab choice
  useEffect(() => {
    window.localStorage.setItem(STORAGE_TAB, tab);
  }, [tab]);

  // Persist sessions
  useEffect(() => {
    window.localStorage.setItem(STORAGE_SESSIONS, JSON.stringify(sessions));
  }, [sessions]);

  const addSession = useCallback(() => {
    const id = uid();
    setSessions((prev) => {
      const next = [...prev, { id, label: `Terminal ${prev.length + 1}` }];
      setCurrentIdx(next.length - 1);
      return next;
    });
  }, []);

  const removeSession = useCallback(
    (idx: number) => {
      setSessions((prev) => {
        const next = prev.filter((_, i) => i !== idx);
        setCurrentIdx((ci) => {
          if (next.length === 0) return 0;
          if (ci >= next.length) return next.length - 1;
          if (ci > idx) return ci - 1;
          return ci;
        });
        return next;
      });
    },
    [],
  );

  const renameSession = useCallback((idx: number, label: string) => {
    setSessions((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, label } : s)),
    );
  }, []);

  const openFilePreview = useCallback(async (path: string) => {
    setPreviewPath(path);
    setPreviewLoading(true);
    setPreviewContent(null);
    try {
      const res = await fetch(
        `/api/project-file?path=${encodeURIComponent(path)}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as {
        ok: boolean;
        content?: string;
        error?: string;
      };
      if (json.ok && typeof json.content === "string") {
        setPreviewContent(json.content);
      } else {
        setPreviewContent(`// Error: ${json.error ?? "unknown"}`);
      }
    } catch (err) {
      setPreviewContent(`// Fetch failed: ${String(err)}`);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-3 py-1.5 text-xs">
        <button
          type="button"
          onClick={() => setTab("comux")}
          className={`rounded px-2 py-0.5 transition-colors ${
            tab === "comux"
              ? "bg-[var(--bg-base)] text-[var(--text-primary)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          Comux
        </button>
        <button
          type="button"
          onClick={() => setTab("project")}
          className={`rounded px-2 py-0.5 transition-colors ${
            tab === "project"
              ? "bg-[var(--bg-base)] text-[var(--text-primary)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          Project
        </button>
      </div>

      {/* Tab content */}
      {tab === "comux" ? (
        <div className="flex flex-1 flex-col min-h-0">
          {/* Session tab strip */}
          <div className="flex items-center gap-0.5 border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 px-2 py-1 text-[11px]">
            {sessions.map((s, i) => (
              <div
                key={s.id}
                className={`group flex items-center gap-1 rounded px-2 py-0.5 cursor-pointer transition-colors ${
                  i === currentIdx
                    ? "bg-[var(--bg-base)] text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
                onClick={() => setCurrentIdx(i)}
              >
                <span
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) =>
                    renameSession(i, e.currentTarget.textContent ?? s.label)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.target as HTMLElement).blur();
                    }
                  }}
                  className="outline-none max-w-[120px] truncate"
                >
                  {s.label}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSession(i);
                  }}
                  className="hidden group-hover:inline text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  x
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addSession}
              className="rounded px-1.5 py-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)]"
            >
              +
            </button>
          </div>

          {/* Terminal area */}
          <div className="flex-1 min-h-0">
            {sessions.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
                <p>No terminal sessions.</p>
                <button
                  type="button"
                  onClick={addSession}
                  className="rounded border border-[var(--border-hairline)] px-3 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                >
                  + New terminal
                </button>
              </div>
            ) : (
              sessions.map((s, i) => (
                <div
                  key={s.id}
                  className="h-full w-full"
                  style={{ display: i === currentIdx ? "block" : "none" }}
                >
                  <BottomTerminal threadId={`cave.comux.${s.id}`} />
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        /* Project tab */
        <div className="flex flex-1 min-h-0">
          {/* Tree (40%) */}
          <div className="w-[40%] shrink-0 overflow-y-auto border-r border-[var(--border-hairline)] p-2 text-xs">
            <ProjectTree ref={treeRef} onFileClick={openFilePreview} />
          </div>
          {/* Preview (60%) */}
          <div className="flex-1 min-w-0 overflow-auto p-3">
            {previewPath ? (
              <>
                <div className="mb-2 truncate text-[11px] text-[var(--text-muted)]">
                  {previewPath}
                </div>
                {previewLoading ? (
                  <p className="text-xs text-[var(--text-muted)]">Loading...</p>
                ) : (
                  <SyntaxBlock
                    text={previewContent ?? ""}
                    lang={previewPath?.split(".").pop()}
                    className="leading-relaxed"
                  />
                )}
              </>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">
                Select a file to preview.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
