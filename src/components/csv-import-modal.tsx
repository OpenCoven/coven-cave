"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Icon } from "@/lib/icon";
import {
  parseCsv,
  detectTargetList,
  suggestMapping,
  buildBookmarksFromCsv,
  buildReadingItemsFromCsv,
  buildGitHubItemsFromCsv,
  type CsvTargetList,
  type ColumnMapping,
} from "@/lib/csv-import";

// ── Types ────────────────────────────────────────────────────────

type Props = {
  raw: string;
  familiar: string;
  onImport: (count: number) => void;
  onClose: () => void;
};

const TARGET_LIST_LABELS: Record<CsvTargetList, string> = {
  bookmarks: "Bookmarks",
  reading: "Reading List",
  github: "GitHub Items",
  unknown: "Unknown",
};

const BOOKMARK_FIELDS: { key: string; label: string; required: boolean }[] = [
  { key: "url", label: "URL", required: true },
  { key: "title", label: "Title", required: false },
  { key: "notes", label: "Notes", required: false },
  { key: "tags", label: "Tags", required: false },
];

const READING_FIELDS: { key: string; label: string; required: boolean }[] = [
  { key: "title", label: "Title", required: true },
  { key: "url", label: "URL", required: false },
  { key: "author", label: "Author", required: false },
  { key: "sourceType", label: "Source Type", required: false },
  { key: "status", label: "Status", required: false },
  { key: "notes", label: "Notes", required: false },
  { key: "tags", label: "Tags", required: false },
];

const GITHUB_FIELDS: { key: string; label: string; required: boolean }[] = [
  { key: "url", label: "URL", required: true },
  { key: "title", label: "Title", required: false },
  { key: "repo", label: "Repository", required: false },
  { key: "kind", label: "Kind", required: false },
  { key: "notes", label: "Notes", required: false },
];

function fieldsForTarget(t: CsvTargetList) {
  if (t === "bookmarks") return BOOKMARK_FIELDS;
  if (t === "reading") return READING_FIELDS;
  if (t === "github") return GITHUB_FIELDS;
  return BOOKMARK_FIELDS;
}

// ── CsvImportModal ───────────────────────────────────────────────

export function CsvImportModal({ raw, familiar, onImport, onClose }: Props) {
  const parsed = useMemo(() => parseCsv(raw), [raw]);
  const detected = detectTargetList(parsed.headers);

  const [targetList, setTargetList] = useState<CsvTargetList>(detected === "unknown" ? "bookmarks" : detected);
  const [mapping, setMapping] = useState<ColumnMapping>(() => suggestMapping(parsed.headers, detected === "unknown" ? "bookmarks" : detected));
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ count: number; failed: number } | null>(null);

  // Re-suggest mapping when targetList changes
  useEffect(() => {
    setMapping(suggestMapping(parsed.headers, targetList));
  }, [targetList, parsed.headers]);

  const previewRows = parsed.rows.slice(0, 5);
  const fields = fieldsForTarget(targetList);

  const handleImport = async () => {
    setImporting(true);
    setImportError(null);

    let items: Array<{ url?: string; title?: string; repo?: string }> = [];
    let endpoint = "/api/library/bookmarks";
    let bodies: object[] = [];

    if (targetList === "bookmarks") {
      items = buildBookmarksFromCsv(parsed.rows, mapping, familiar);
      endpoint = "/api/library/bookmarks";
      bodies = items.map((item) => item);
    } else if (targetList === "reading") {
      items = buildReadingItemsFromCsv(parsed.rows, mapping, familiar);
      endpoint = "/api/library/reading";
      bodies = items.map((item) => item);
    } else if (targetList === "github") {
      items = buildGitHubItemsFromCsv(parsed.rows, mapping, familiar);
      endpoint = "/api/library/github";
      bodies = items.map((item) => item);
    }

    let succeeded = 0;
    let failed = 0;

    await Promise.all(
      bodies.map(async (body) => {
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          if (res.ok) succeeded++;
          else failed++;
        } catch {
          failed++;
        }
      }),
    );

    setImporting(false);
    setImportResult({ count: succeeded, failed });
    if (succeeded > 0) onImport(succeeded);
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      breadcrumb={["Library", "Import CSV"]}
      footerActions={
        importResult ? (
          <button
            onClick={onClose}
            className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            Done
          </button>
        ) : (
          <>
            <button
              onClick={onClose}
              className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleImport()}
              disabled={importing || targetList === "unknown"}
              className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
            >
              {importing ? "Importing\u2026" : `Import ${parsed.rows.length} item${parsed.rows.length !== 1 ? "s" : ""}`}
            </button>
          </>
        )
      }
    >
      {importResult ? (
        <div className="py-6 text-center">
          <div className="mb-3 text-4xl">
            {importResult.failed === 0 ? "\u2705" : "\u26a0\ufe0f"}
          </div>
          <div className="text-sm font-medium text-[var(--text-primary)]">
            {importResult.count} item{importResult.count !== 1 ? "s" : ""} imported
            {importResult.failed > 0 ? ` (${importResult.failed} failed)` : ""}
          </div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            Added to {TARGET_LIST_LABELS[targetList]}
          </div>
        </div>
      ) : (
        <>
          {/* Summary row */}
          <div className="mb-4 flex items-center gap-3 rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-xs text-[var(--text-secondary)]">
            <Icon name="ph:file-text" width={14} className="shrink-0 text-[var(--text-muted)]" />
            <span>{parsed.rows.length} rows \u00b7 {parsed.headers.length} columns</span>
            {detected !== "unknown" && (
              <span className="ml-auto rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--text-muted)]">
                Detected: {TARGET_LIST_LABELS[detected]}
              </span>
            )}
          </div>

          {/* Target list selector */}
          <div className="mb-4">
            <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Import as
            </label>
            <div className="flex gap-2">
              {(["bookmarks", "reading", "github"] as CsvTargetList[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTargetList(t)}
                  className={`rounded border px-3 py-1.5 text-xs transition-colors ${
                    targetList === t
                      ? "border-[var(--accent-presence)] bg-[var(--accent-presence)] text-white"
                      : "border-[var(--border-hairline)] bg-[var(--bg-base)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                  }`}
                >
                  {TARGET_LIST_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Column mapping */}
          <div className="mb-4">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Column mapping
            </div>
            <div className="grid grid-cols-2 gap-2">
              {fields.map((field) => (
                <label key={field.key} className="flex flex-col gap-1">
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {field.label}{field.required ? " *" : ""}
                  </span>
                  <div className="relative">
                    <select
                      value={mapping.fieldMappings[field.key] ?? ""}
                      onChange={(e) =>
                        setMapping((prev) => ({
                          ...prev,
                          fieldMappings: { ...prev.fieldMappings, [field.key]: e.target.value },
                        }))
                      }
                      className="w-full appearance-none rounded border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1.5 pr-6 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
                    >
                      <option value="">\u2014 skip \u2014</option>
                      {parsed.headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-[9px]">
                      \u25be
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Preview table */}
          <div>
            <div className="mb-2 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Preview (first {previewRows.length} rows)
            </div>
            <div className="overflow-x-auto rounded border border-[var(--border-hairline)]">
              <table className="w-full min-w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-hairline)] bg-[var(--bg-raised)]">
                    {parsed.headers.map((h) => (
                      <th key={h} className="px-2 py-1.5 text-left font-medium text-[var(--text-muted)]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => (
                    <tr key={i} className="border-b border-[var(--border-hairline)] last:border-0">
                      {parsed.headers.map((h) => (
                        <td key={h} className="max-w-[160px] truncate px-2 py-1.5 text-[var(--text-secondary)]">
                          {row[h] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {importError && (
            <div className="mt-3 rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-xs text-red-400">
              {importError}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
