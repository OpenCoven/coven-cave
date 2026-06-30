"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { ProjectTree } from "@/components/project-tree";
import { parseListInput } from "@/lib/automations/list-input";
import type { CaveProject } from "@/lib/cave-projects-types";

/**
 * Working-directories field: a free-text list (one path per line) plus a
 * "Browse projects" modal that walks the user's projects with the shared
 * ProjectTree and toggles directories in/out of the list. Reusable so the
 * cron create dialog and the cron detail editor offer the same picker rather
 * than the create dialog's old type-a-raw-path-only textarea.
 *
 * `value` is the raw newline-separated text (so typing stays unsurprising —
 * blank lines aren't eaten mid-edit); the picker appends resolved paths.
 */
export function CwdPickerField({
  value,
  onChange,
  familiarId = "",
  textareaClass,
  fieldStyle,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Scopes ProjectTree reads to a familiar's workspace, when known. */
  familiarId?: string;
  textareaClass: string;
  fieldStyle?: CSSProperties;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projects, setProjects] = useState<CaveProject[]>([]);
  // Shared focus trap: Escape-to-close, Tab cycling, and focus into/back out of
  // the dialog — the app's one dialog-dismissal path, instead of a bespoke
  // inline Escape handler.
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(pickerOpen, dialogRef, { onEscape: () => setPickerOpen(false) });

  const list = useMemo(() => parseListInput(value), [value]);
  const selectedDirs = useMemo(() => new Set(list), [list]);

  const addCwd = (dir: string) => {
    const clean = dir.trim();
    if (!clean || list.includes(clean)) return;
    onChange([...list, clean].join("\n"));
  };

  // Lazy-load the project list the first time the picker opens.
  useEffect(() => {
    if (!pickerOpen || projects.length > 0) return;
    let alive = true;
    void fetch("/api/projects")
      .then((res) => res.json())
      .then((data: { ok?: boolean; projects?: CaveProject[] }) => {
        if (alive && data.ok && Array.isArray(data.projects)) setProjects(data.projects);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [pickerOpen, projects.length]);

  return (
    <>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        placeholder="/path/to/repo (one per line)"
        className={textareaClass}
        style={fieldStyle}
        spellCheck={false}
      />
      <div className="mt-1 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="focus-ring inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:folder-open" width={12} aria-hidden />
          Browse projects…
        </button>
        {list.length > 0 && (
          <span className="text-[10px] text-[var(--text-muted)]">
            {list.length} {list.length === 1 ? "directory" : "directories"}
          </span>
        )}
      </div>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Pick working directories"
          onClick={() => setPickerOpen(false)}
        >
          <div
            ref={dialogRef}
            className="flex max-h-[80vh] w-[460px] max-w-full flex-col overflow-hidden rounded-lg border border-[var(--border-hairline)] shadow-xl"
            style={{ background: "var(--bg-panel)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-3 py-2">
              <span className="text-[13px] font-semibold text-[var(--text-primary)]">Working directories</span>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                aria-label="Close"
                className="focus-ring grid h-6 w-6 place-items-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
              >
                <Icon name="ph:x" width={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {projects.length === 0 ? (
                <p className="px-2 py-4 text-[12px] text-[var(--text-muted)]">
                  No projects found. Add a project in the Code workspace first, or type a path into the field.
                </p>
              ) : (
                projects.map((proj) => (
                  <div key={proj.root} className="mb-2">
                    <div className="flex items-center justify-between gap-2 px-1 py-1">
                      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                        {proj.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => addCwd(proj.root)}
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                          selectedDirs.has(proj.root)
                            ? "text-[var(--accent-presence)]"
                            : "text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        {selectedDirs.has(proj.root) ? "Added" : "Use root"}
                      </button>
                    </div>
                    <ProjectTree
                      root={proj.root}
                      familiarId={familiarId}
                      onDirSelect={addCwd}
                      selectedDirs={selectedDirs}
                    />
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center justify-between border-t border-[var(--border-hairline)] px-3 py-2">
              <span className="text-[11px] text-[var(--text-muted)]">
                {list.length} {list.length === 1 ? "directory" : "directories"} selected
              </span>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="rounded-md px-3 py-1 text-[12px] font-medium text-white"
                style={{ background: "var(--accent-presence)" }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
