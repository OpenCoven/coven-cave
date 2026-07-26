"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { ProjectTree } from "@/components/project-tree";
import { Button } from "@/components/ui/button";
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
}: {
  value: string;
  onChange: (next: string) => void;
  /** Scopes ProjectTree reads to a familiar's workspace, when known. */
  familiarId?: string;
  textareaClass: string;
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
        aria-label="Working directories, one per line"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        placeholder="/path/to/repo (one per line)"
        className={textareaClass}
        spellCheck={false}
      />
      <div className="mt-1 flex items-center justify-between">
        <Button
          variant="ghost"
          size="xs"
          leadingIcon="ph:folder-open"
          onClick={() => setPickerOpen(true)}
          className="rounded-[var(--radius-control)] px-2 py-1 text-[length:var(--text-xs)] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
        >
          Browse projects…
        </Button>
        {list.length > 0 && (
          <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">
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
            className="flex max-h-[80vh] w-[460px] max-w-full flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border-hairline)] shadow-xl [background:var(--bg-panel)]!"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-3 py-2">
              <span className="text-[length:var(--text-base)] font-semibold text-[var(--text-primary)]">Working directories</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setPickerOpen(false)}
                aria-label="Close"
                className="grid h-6 w-6 place-items-center rounded-[var(--radius-control)] p-0 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                leadingIcon="ph:x"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {projects.length === 0 ? (
                <p className="px-2 py-4 text-[length:var(--text-sm)] text-[var(--text-muted)]">
                  No projects found. Add a project in the Code workspace first, or type a path into the field.
                </p>
              ) : (
                projects.map((proj) => (
                  <div key={proj.root} className="mb-2">
                    <div className="flex items-center justify-between gap-2 px-1 py-1">
                      <span className="min-w-0 flex-1 truncate text-[length:var(--text-xs)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                        {proj.name}
                      </span>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => addCwd(proj.root)}
                        className={`shrink-0 rounded-[var(--radius-control)] px-1.5 py-0.5 text-[length:var(--text-2xs)] font-medium transition-colors ${
                          selectedDirs.has(proj.root)
                            ? "text-[var(--accent-presence)]"
                            : "text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        {selectedDirs.has(proj.root) ? "Added" : "Use root"}
                      </Button>
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
              <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
                {list.length} {list.length === 1 ? "directory" : "directories"} selected
              </span>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setPickerOpen(false)}
                className="rounded-[var(--radius-control)] px-3 py-1 text-[length:var(--text-sm)] font-medium"
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
