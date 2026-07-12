"use client";

import { useEffect } from "react";
import { useShellBanners } from "@/lib/shell-banners";

type MigrationStatus = {
  pending: string[];
  conflicts: string[];
  migrated: boolean;
};

type StatusPayload = { ok?: boolean; status?: MigrationStatus };
type RunPayload = StatusPayload & {
  result?: { moved?: string[]; errors?: Array<{ legacy: string; error: string }> };
};

const MIGRATION_BANNER_ID = "cave-home-migration";

/** Dismissal is keyed by the exact pending set, so NEW stragglers re-surface. */
const MIGRATION_DISMISS_KEY = (pending: string[]) =>
  `coven-cave:cave-home-migration:dismissed:${[...pending].sort().join("|")}`;

function dismissedMigrationBanner(pending: string[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MIGRATION_DISMISS_KEY(pending)) === "1";
  } catch {
    return false;
  }
}

function dismissMigrationBanner(pending: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MIGRATION_DISMISS_KEY(pending), "1");
  } catch {
    /* private mode */
  }
}

function pendingBannerTitle(pending: string[]): string {
  const count = pending.length;
  return `${count} legacy Cave file${count === 1 ? "" : "s"} in ~/.coven still need${count === 1 ? "s" : ""} to move into ~/.coven/cave.`;
}

/**
 * Shell banner for "qualified participants" of the cave home migration:
 * machines where the boot-time migration (instrumentation.ts) errored or was
 * interrupted, leaving real legacy `cave-*` files at the top of `~/.coven`.
 *
 * Everyone else — fresh installs and machines the boot migration already
 * cleaned — never sees it. The CTA runs the same idempotent migration on
 * demand, reports the outcome in place, and clears once nothing is pending.
 */
export function CaveHomeMigrationBannerTrigger() {
  const { pushBanner, dismissBanner } = useShellBanners();

  useEffect(() => {
    let cancelled = false;

    const showPendingBanner = (pending: string[]) => {
      pushBanner({
        id: MIGRATION_BANNER_ID,
        severity: "warning",
        title: pendingBannerTitle(pending),
        cta: {
          label: "Migrate now",
          onClick: () => {
            void runMigration();
          },
        },
        onDismiss: () => dismissMigrationBanner(pending),
      });
    };

    const runMigration = async () => {
      try {
        const res = await fetch("/api/cave-home-migration", { method: "POST" });
        const json = (await res.json()) as RunPayload;
        if (cancelled) return;
        const remaining = json.status?.pending ?? [];
        const errors = json.result?.errors ?? [];
        if (remaining.length === 0 && errors.length === 0) {
          const moved = json.result?.moved?.length ?? 0;
          pushBanner({
            id: MIGRATION_BANNER_ID,
            severity: "info",
            title:
              moved > 0
                ? `Cave files migrated — moved ${moved} file${moved === 1 ? "" : "s"} into ~/.coven/cave.`
                : "Cave files are already in ~/.coven/cave — nothing left to migrate.",
          });
          return;
        }
        pushBanner({
          id: MIGRATION_BANNER_ID,
          severity: "error",
          title: `Cave file migration could not finish — ${remaining.length} file${remaining.length === 1 ? "" : "s"} still pending${errors.length > 0 ? ` (first error: ${errors[0].error})` : ""}.`,
          cta: {
            label: "Retry migration",
            onClick: () => {
              void runMigration();
            },
          },
          onDismiss: () => dismissMigrationBanner(remaining),
        });
      } catch {
        /* Route unreachable — leave the current banner in place for a retry. */
      }
    };

    void fetch("/api/cave-home-migration", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as StatusPayload) : null))
      .then((json) => {
        if (cancelled || !json?.ok || !json.status) return;
        const pending = json.status.pending ?? [];
        if (pending.length === 0 || dismissedMigrationBanner(pending)) return;
        showPendingBanner(pending);
      })
      .catch(() => {
        /* Status checks are best-effort. */
      });

    return () => {
      cancelled = true;
      dismissBanner(MIGRATION_BANNER_ID);
    };
  }, [pushBanner, dismissBanner]);

  return null;
}
