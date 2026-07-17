"use client";

import { useCallback, useEffect, useState } from "react";
import { useShellBanners } from "@/lib/shell-banners";
import { usePausablePoll } from "@/lib/use-pausable-poll";

type MigrationAction = "merge" | "keep-canonical" | "recover-legacy" | "defer";

type MigrationDetail = {
  legacy: string;
  next: string;
  strategy: "inbox" | "state" | "preferences" | "directory" | "manual";
  legacyPath: string;
  canonicalPath: string;
  legacyHash?: string;
  canonicalHash?: string;
  legacyMtimeMs?: number;
  canonicalMtimeMs?: number;
  state: "pending" | "unresolved" | "managed";
  summary: string;
  differences: string[];
  backupPath?: string;
  actions: MigrationAction[];
};

type MigrationStatus = {
  pending: string[];
  conflicts: string[];
  migrated: boolean;
  details: MigrationDetail[];
  backupRoot: string;
  journalPath: string;
};

type StatusPayload = { ok?: boolean; status?: MigrationStatus; error?: string };
type RunPayload = StatusPayload & {
  result?: {
    moved?: string[];
    resolved?: string[];
    errors?: Array<{ legacy: string; error: string }>;
  };
};

const MIGRATION_BANNER_ID = "cave-home-migration";
const CONFLICT_DISMISS_KEY = (details: MigrationDetail[]) =>
  `coven-cave:cave-home-migration:review-dismissed:${details
    .map((detail) => [
      detail.legacy,
      detail.state,
      detail.legacyHash ?? "missing",
      detail.canonicalHash ?? "missing",
    ].join(":"))
    .sort()
    .join("|")}`;

function dismissed(details: MigrationDetail[]): boolean {
  try {
    return window.localStorage.getItem(CONFLICT_DISMISS_KEY(details)) === "1";
  } catch {
    return false;
  }
}

function rememberDismissal(details: MigrationDetail[]): void {
  try {
    window.localStorage.setItem(CONFLICT_DISMISS_KEY(details), "1");
  } catch {
    // Private browsing can reject storage. Dismissal still lasts this mount.
  }
}

function formatTime(value?: number): string {
  if (!value) return "Missing";
  return new Date(value).toLocaleString();
}

function actionLabel(action: MigrationAction): string {
  if (action === "merge") return "Merge safely";
  if (action === "keep-canonical") return "Keep current";
  if (action === "recover-legacy") return "Recover legacy";
  return "Defer";
}

async function openBackupFolder(path: string): Promise<boolean> {
  if (!("__TAURI_INTERNALS__" in window)) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("shell_open_path", { path });
    return true;
  } catch {
    return false;
  }
}

export function CaveHomeMigrationBannerTrigger() {
  const { pushBanner, dismissBanner } = useShellBanners();
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const publish = useCallback((next: MigrationStatus) => {
    setStatus(next);
    const names = [...next.pending, ...next.conflicts];
    if (names.length === 0) {
      dismissBanner(MIGRATION_BANNER_ID);
      setReviewOpen(false);
      return;
    }
    if (dismissed(next.details)) return;
    const conflicts = next.conflicts.length;
    pushBanner({
      id: MIGRATION_BANNER_ID,
      severity: "warning",
      title: conflicts > 0
        ? `${conflicts} Cave data conflict${conflicts === 1 ? " needs" : "s need"} review. Both copies are preserved until you choose.`
        : `${next.pending.length} legacy Cave file${next.pending.length === 1 ? " is" : "s are"} ready for safe migration.`,
      cta: { label: "Review files", onClick: () => setReviewOpen(true) },
      onDismiss: () => rememberDismissal(next.details),
    });
  }, [dismissBanner, pushBanner]);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/cave-home-migration", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json() as StatusPayload;
    if (payload.ok && payload.status) publish(payload.status);
  }, [publish]);

  // Ordinary Windows mirrors can be changed by an older tool after Cave has
  // started. Re-check while the shell is visible so those writes are surfaced
  // without requiring an app restart.
  usePausablePoll(() => void refresh(), 30_000, { pauseWhileInputActive: true });

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/cave-home-migration", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as StatusPayload : null)
      .then((payload) => {
        if (!cancelled && payload?.ok && payload.status) publish(payload.status);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      dismissBanner(MIGRATION_BANNER_ID);
    };
  }, [dismissBanner, publish]);

  const runAction = async (detail: MigrationDetail, action: MigrationAction) => {
    setWorking(`${detail.legacy}:${action}`);
    setNotice(null);
    try {
      const response = await fetch("/api/cave-home-migration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ legacy: detail.legacy, action }),
      });
      const payload = await response.json() as RunPayload;
      if (!response.ok || !payload.status) throw new Error(payload.error ?? "Migration request failed");
      publish(payload.status);
      const firstError = payload.result?.errors?.[0];
      setNotice(firstError ? `${firstError.legacy}: ${firstError.error}` : `${detail.legacy}: ${actionLabel(action)} complete.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Migration request failed");
      await refresh();
    } finally {
      setWorking(null);
    }
  };

  if (!reviewOpen || !status) return null;

  return (
    <div className="cave-migration-review-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setReviewOpen(false);
    }}>
      <section className="cave-migration-review" role="dialog" aria-modal="true" aria-labelledby="cave-migration-title">
        <header className="cave-migration-review__header">
          <div>
            <h2 id="cave-migration-title">Review Cave data migration</h2>
            <p>Canonical storage is <code>~/.coven/cave</code>. Cave verifies a recovery bundle before changing either divergent copy.</p>
          </div>
          <button type="button" aria-label="Close migration review" onClick={() => setReviewOpen(false)}>×</button>
        </header>

        <div className="cave-migration-review__files">
          {status.details.map((detail) => (
            <article className="cave-migration-file" key={detail.legacy}>
              <div className="cave-migration-file__heading">
                <strong>{detail.legacy}</strong>
                <span>{detail.strategy === "manual" ? "Manual decision" : `${detail.strategy} reconciliation`}</span>
              </div>
              <p>{detail.summary}</p>
              <ul className="cave-migration-file__diff">
                {detail.differences.map((difference) => <li key={difference}>{difference}</li>)}
              </ul>
              <dl>
                <div><dt>Legacy</dt><dd>{formatTime(detail.legacyMtimeMs)}</dd></div>
                <div><dt>Canonical</dt><dd>{formatTime(detail.canonicalMtimeMs)}</dd></div>
              </dl>
              {detail.backupPath ? <p className="cave-migration-file__backup">Recovery bundle: {detail.backupPath}</p> : null}
              <div className="cave-migration-file__actions">
                {detail.actions.map((action) => (
                  <button
                    type="button"
                    key={action}
                    disabled={working !== null}
                    onClick={() => void runAction(detail, action)}
                  >
                    {working === `${detail.legacy}:${action}`
                      ? "Working…"
                      : action === "merge" && detail.state === "pending" ? "Migrate safely" : actionLabel(action)}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>

        <footer className="cave-migration-review__footer">
          <span role="status">{notice}</span>
          <div>
            <button type="button" onClick={() => void openBackupFolder(status.backupRoot).then((ok) => {
              if (!ok) setNotice(`Backups are stored at ${status.backupRoot}`);
            })}>Open backup folder</button>
            <button type="button" onClick={() => setReviewOpen(false)}>Close</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
