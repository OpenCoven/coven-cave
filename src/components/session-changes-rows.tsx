import { useState } from "react";
import { SyntaxBlock } from "@/components/message-bubble";
import { Icon } from "@/lib/icon";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, splitFilePath, checkpointLabel } from "@/lib/session-changes-format";
import type { ChangedFile, CheckpointMeta, DiffState, FileStatus } from "@/lib/session-changes-api";

const STATUS_META: Record<FileStatus, { letter: string; label: string; color: string }> = {
  modified: { letter: "M", label: "modified", color: "var(--color-warning)" },
  added: { letter: "A", label: "added", color: "var(--accent-presence)" },
  deleted: { letter: "D", label: "deleted", color: "var(--color-danger)" },
  renamed: { letter: "R", label: "renamed", color: "var(--text-secondary)" },
  untracked: { letter: "U", label: "untracked", color: "var(--text-muted)" },
};

function StatusChip({ status }: { status: FileStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      title={meta.label}
      aria-label={meta.label}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-[length:var(--text-2xs)] font-semibold"
      style={{
        color: meta.color,
        background: `color-mix(in oklch, ${meta.color} 14%, transparent)`,
      }}
    >
      {meta.letter}
    </span>
  );
}

// First-load placeholder shaped like the FileRow list (caret · status chip ·
// path · ± counts), matching the app-wide skeleton convention instead of a bare
// "Loading changes…" string.
export function ChangesSkeleton() {
  return (
    <div className="session-changes-table-wrap overflow-hidden rounded-md border border-[var(--border-hairline)]" aria-hidden>
      <table className="session-changes-table w-full table-fixed border-collapse text-[length:var(--text-xs)]">
        <colgroup>
          <col />
          <col className="w-[70px]" />
          <col className="w-[var(--space-8)]" />
        </colgroup>
        <tbody className="divide-y divide-[var(--border-hairline)]">
          {Array.from({ length: 5 }).map((_, i) => (
            <tr key={i}>
              <td className="px-2 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Skeleton variant="text" width={10} height={10} />
                  <Skeleton variant="text" width={16} height={16} />
                  <div className="min-w-0 flex-1">
                    <Skeleton variant="text" width={`${62 - i * 7}%`} />
                  </div>
                </div>
              </td>
              <td className="px-2 py-1.5">
                <Skeleton variant="text" width={34} height={10} />
              </td>
              <td className="px-2 py-1.5">
                <Skeleton variant="text" width={18} height={14} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── File row ──────────────────────────────────────────────────────────────────

export function FileRow({
  file,
  expanded,
  diffState,
  reverting,
  onToggle,
  onRevert,
}: {
  file: ChangedFile;
  expanded: boolean;
  diffState: DiffState | undefined;
  reverting: boolean;
  onToggle: () => void;
  onRevert: () => void;
}) {
  // Two-step revert: first click arms an inline Cancel/Revert confirm that
  // replaces the row action; only the explicit confirm commits. "New" files
  // (untracked, or staged-but-never-committed) get delete copy because
  // reverting one deletes it — it has no committed version to restore.
  const [confirmRevert, setConfirmRevert] = useState(false);
  const untracked = file.status === "untracked" || file.status === "added";
  const { basename, dirname } = splitFilePath(file.path);
  const diffCounts =
    typeof file.insertions === "number" || typeof file.deletions === "number" ? (
      <>
        <span className="text-[var(--accent-presence)]">+{file.insertions ?? 0}</span>{" "}
        <span className="text-[var(--color-danger)]">−{file.deletions ?? 0}</span>
      </>
    ) : (
      <span className="text-[var(--text-muted)]">--</span>
    );

  return (
    <>
      <tr className="session-changes-table-row group align-middle transition-colors hover:bg-[var(--bg-hover)]">
        <td className="min-w-0 overflow-hidden px-2 py-1.5">
          <button
            type="button"
            className="focus-ring flex w-full min-w-0 items-center gap-2 rounded text-left text-[length:var(--text-xs)]"
            onClick={onToggle}
            aria-expanded={expanded}
            title={file.renamedFrom ? `${file.renamedFrom} → ${file.path}` : file.path}
          >
            <Icon name={expanded ? "ph:caret-down" : "ph:caret-right"} width={10} aria-hidden className="shrink-0" />
            <StatusChip status={file.status} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[length:var(--text-xs)] font-medium text-[var(--text-secondary)]">
                {basename}
              </span>
              {dirname ? (
                <span className="block truncate font-mono text-[length:var(--text-2xs)] leading-tight text-[var(--text-muted)]">
                  {dirname}
                </span>
              ) : null}
            </span>
          </button>
        </td>
        <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[length:var(--text-2xs)] tabular-nums">{diffCounts}</td>
        <td className="px-2 py-1.5 text-right">
          {confirmRevert ? null : (
            <IconButton
              icon={untracked ? "ph:trash" : "ph:arrow-counter-clockwise"}
              size="sm"
              danger
              onClick={() => setConfirmRevert(true)}
              disabled={reverting}
              title={untracked ? `Delete ${file.path}` : `Revert ${file.path}`}
              aria-label={untracked ? `Delete untracked file ${file.path}` : `Revert ${file.path}`}
            />
          )}
        </td>
      </tr>
      {confirmRevert ? (
        <tr className="bg-[color-mix(in_oklch,var(--color-danger)_7%,transparent)]">
          <td colSpan={3} className="px-2 py-1.5">
            <span
              className="flex min-w-0 items-center justify-end gap-1.5"
              role="group"
              aria-label={untracked ? "Confirm untracked file deletion" : "Confirm file revert"}
            >
              <span className="min-w-0 flex-1 truncate text-[length:var(--text-2xs)] font-medium text-[var(--color-danger)]">
                {untracked ? "Delete file?" : "Revert file?"}
              </span>
              <button
                type="button"
                onClick={() => setConfirmRevert(false)}
                className="focus-ring rounded border border-[var(--border-hairline)] px-1.5 py-0.5 text-[length:var(--text-2xs)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmRevert(false);
                  onRevert();
                }}
                disabled={reverting}
                aria-label={untracked ? `Confirm delete ${file.path}` : `Confirm revert ${file.path}`}
                className="focus-ring inline-flex items-center gap-1 rounded border border-[color-mix(in_oklch,var(--color-danger)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_18%,transparent)] px-1.5 py-0.5 text-[length:var(--text-2xs)] font-medium text-[var(--color-danger)] transition-colors hover:bg-[color-mix(in_oklch,var(--color-danger)_30%,transparent)] disabled:opacity-40"
              >
                <Icon name={untracked ? "ph:trash" : "ph:arrow-counter-clockwise"} width={10} aria-hidden />
                {reverting ? "…" : untracked ? "Delete" : "Revert"}
              </button>
            </span>
          </td>
        </tr>
      ) : null}
      {expanded ? (
        <tr>
          <td colSpan={3} className="border-t border-[var(--border-hairline)] p-2">
          {!diffState || diffState.loading ? (
            <div className="py-1 text-[length:var(--text-2xs)] text-[var(--text-muted)]">Loading diff…</div>
          ) : diffState.error ? (
            <div className="py-1 text-[length:var(--text-2xs)] text-[var(--color-danger)]">diff: {diffState.error}</div>
          ) : !diffState.diff ? (
            <div className="py-1 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
              No textual diff (binary file or staged-only state).
            </div>
          ) : (
            <>
              <div className="max-h-80 overflow-auto">
                <SyntaxBlock text={diffState.diff} lang="diff" className="text-[length:var(--text-xs)]" />
              </div>
              {diffState.truncated ? (
                <div className="pt-1 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                  Diff truncated at 200KB.
                </div>
              ) : null}
            </>
          )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ── Checkpoints ────────────────────────────────────────────────────────────────

function CheckpointRow({
  cp,
  busy,
  onRestore,
  onDelete,
}: {
  cp: CheckpointMeta;
  busy: boolean;
  onRestore: () => void;
  onDelete: () => void;
}) {
  // Restore mutates the working tree, so it gets the same two-step confirm as
  // revert. Delete is non-destructive to the worktree (drops a snapshot), so
  // it's a single click.
  const [confirmRestore, setConfirmRestore] = useState(false);
  const label = checkpointLabel(cp.name);

  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--border-hairline)] px-2 py-1.5">
      <Icon name="ph:archive" width={11} aria-hidden className="shrink-0 text-[var(--text-muted)]" />
      <span className="min-w-0 flex-1 truncate text-[length:var(--text-xs)] text-[var(--text-secondary)]" title={cp.name}>
        {label}
      </span>
      <span className="shrink-0 font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]">{formatBytes(cp.bytes)}</span>
      {confirmRestore ? (
        <span className="flex shrink-0 items-center gap-1.5" role="group" aria-label="Confirm checkpoint restore">
          <span className="text-[length:var(--text-2xs)] font-medium text-[var(--text-secondary)]">Restore?</span>
          <button
            type="button"
            onClick={() => setConfirmRestore(false)}
            className="focus-ring rounded border border-[var(--border-hairline)] px-1.5 py-0.5 text-[length:var(--text-2xs)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setConfirmRestore(false);
              onRestore();
            }}
            aria-label={`Confirm restore checkpoint ${label}`}
            className="focus-ring inline-flex items-center gap-1 rounded border border-[var(--border-hairline)] px-1.5 py-0.5 text-[length:var(--text-2xs)] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-raised)] disabled:opacity-40"
          >
            <Icon name="ph:arrow-counter-clockwise" width={10} aria-hidden />
            {busy ? "…" : "Restore"}
          </button>
        </span>
      ) : (
        <>
          <IconButton
            icon="ph:arrow-counter-clockwise"
            size="sm"
            className="shrink-0"
            disabled={busy}
            onClick={() => setConfirmRestore(true)}
            title={`Restore checkpoint ${label}`}
            aria-label={`Restore checkpoint ${label}`}
          />
          <IconButton
            icon="ph:trash"
            size="sm"
            danger
            className="shrink-0"
            disabled={busy}
            onClick={onDelete}
            title={`Delete checkpoint ${label}`}
            aria-label={`Delete checkpoint ${label}`}
          />
        </>
      )}
    </div>
  );
}

export function CheckpointSection({
  checkpoints,
  open,
  busyName,
  onToggleOpen,
  onRestore,
  onDelete,
}: {
  checkpoints: CheckpointMeta[];
  open: boolean;
  busyName: string | null;
  onToggleOpen: () => void;
  onRestore: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  return (
    <div className="mt-3 border-t border-[var(--border-hairline)] pt-2">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        className="focus-ring flex w-full items-center gap-1.5 text-left text-[length:var(--text-2xs)] font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
      >
        <Icon name={open ? "ph:caret-down" : "ph:caret-right"} width={10} aria-hidden />
        Checkpoints
        <span className="font-mono font-normal normal-case text-[var(--text-muted)]">{checkpoints.length}</span>
      </button>
      {open ? (
        <div className="mt-1.5 flex flex-col gap-1">
          {checkpoints.map((cp) => (
            <CheckpointRow
              key={cp.name}
              cp={cp}
              busy={busyName === cp.name}
              onRestore={() => onRestore(cp.name)}
              onDelete={() => onDelete(cp.name)}
            />
          ))}
          <p className="px-0.5 pt-0.5 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
            Restoring applies a saved snapshot over the working tree (3-way merge).
          </p>
        </div>
      ) : null}
    </div>
  );
}
