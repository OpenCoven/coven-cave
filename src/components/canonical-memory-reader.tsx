"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CanonicalMemoryMarkdown } from "@/components/canonical-memory-markdown";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import {
  CanonicalMemoryRequestError,
  fetchCanonicalMemoryDetail,
} from "@/lib/canonical-memory-client";
import type {
  CanonicalMemoryDetail,
  CanonicalMemoryErrorCode,
} from "@/lib/canonical-memory";
import { Icon } from "@/lib/icon";

export type CanonicalMemoryDetailLoader = (
  memoryId: string,
  signal: AbortSignal,
) => Promise<CanonicalMemoryDetail>;

type CanonicalMemoryReaderProps = {
  memoryId: string | null;
  localDaemonReady: boolean;
  onMissing: () => void;
  onRefresh: () => void | Promise<void>;
  onBack?: () => void;
  onStartDaemon?: () => void;
  loadDetail?: CanonicalMemoryDetailLoader;
};

type ErrorCopy = {
  headline: string;
  subtitle: ReactNode;
};

export function canonicalMemoryErrorCopy(
  code: CanonicalMemoryErrorCode,
): ErrorCopy {
  switch (code) {
    case "local_access_required":
      return {
        headline: "Local access required",
        subtitle: "Canonical memory is available only from Cave on this host.",
      };
    case "local_daemon_required":
      return {
        headline: "Local daemon required",
        subtitle: "Switch Cave to Local daemon to read canonical memory.",
      };
    case "daemon_update_required":
      return {
        headline: "Daemon update required",
        subtitle: "Update Coven, restart the daemon, then retry.",
      };
    case "canonical_memory_unavailable":
      return {
        headline: "Canonical memory unavailable",
        subtitle: (
          <>
            Start the local daemon with <code>coven daemon start</code>, then
            retry.
          </>
        ),
      };
    case "invalid_daemon_payload":
      return {
        headline: "Incompatible daemon response",
        subtitle:
          "The daemon returned an incompatible daemon response. Update Coven, restart the daemon, then retry.",
      };
    case "invalid_memory_id":
      return {
        headline: "Invalid memory selection",
        subtitle: "Return to the list and choose this memory again.",
      };
    case "memory_not_found":
      return {
        headline: "Memory not found",
        subtitle:
          "This canonical memory is no longer available. Return to the list, then refresh.",
      };
  }
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError",
  );
}

export function CanonicalMemoryReader({
  memoryId,
  localDaemonReady,
  onMissing,
  onRefresh,
  onBack,
  onStartDaemon,
  loadDetail = fetchCanonicalMemoryDetail,
}: CanonicalMemoryReaderProps) {
  const [detail, setDetail] = useState<CanonicalMemoryDetail | null>(null);
  const [error, setError] = useState<CanonicalMemoryRequestError | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"rendered" | "raw">("rendered");
  const [retryNonce, setRetryNonce] = useState(0);
  const onMissingRef = useRef(onMissing);
  const mountedRef = useRef(true);
  const refreshGenerationRef = useRef(0);
  onMissingRef.current = onMissing;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshGenerationRef.current += 1;
    };
  }, []);

  async function handleRefresh(): Promise<void> {
    const generation = ++refreshGenerationRef.current;
    try {
      await onRefresh();
    } finally {
      if (
        generation === refreshGenerationRef.current &&
        mountedRef.current
      ) {
        setRetryNonce((current) => current + 1);
      }
    }
  }

  useEffect(() => {
    setDetail(null);
    setError(null);
    setRevealedId(null);
    setMode("rendered");
    if (!memoryId || !localDaemonReady) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let current = true;
    setLoading(true);
    void loadDetail(memoryId, controller.signal)
      .then((entry) => {
        if (!current) return;
        if (entry.id !== memoryId) {
          setError(
            new CanonicalMemoryRequestError("invalid_daemon_payload", 502),
          );
          return;
        }
        setDetail(entry);
      })
      .catch((requestError: unknown) => {
        if (!current || isAbortError(requestError)) return;
        const stableError =
          requestError instanceof CanonicalMemoryRequestError
            ? requestError
            : new CanonicalMemoryRequestError("invalid_daemon_payload", 0);
        setError(stableError);
        if (stableError.code === "memory_not_found") {
          onMissingRef.current();
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [loadDetail, localDaemonReady, memoryId, retryNonce]);

  if (!memoryId) {
    return (
      <div className="grid h-full min-h-0 place-items-center rounded-[var(--radius-card)] border border-dashed border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 p-8">
        <EmptyState
          icon="ph:book-open"
          headline="Select a memory to read"
          subtitle="Pick a familiar memory from the list."
        />
      </div>
    );
  }

  if (!localDaemonReady) {
    return (
      <div className="grid h-full min-h-0 place-items-center rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 p-4">
        <ErrorState
          headline="Local daemon required"
          subtitle={
            <>
              Switch Cave to Local daemon to read canonical memory. If the
              daemon is unavailable, start it with{" "}
              <code>coven daemon start</code>.
            </>
          }
          actions={
            <div className="flex items-center gap-2">
              {onStartDaemon ? (
                <Button size="sm" onClick={onStartDaemon}>
                  Start daemon
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                leadingIcon="ph:arrow-clockwise"
                onClick={() => void handleRefresh()}
              >
                Refresh
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  if (error) {
    const copy = canonicalMemoryErrorCopy(error.code);
    return (
      <div className="grid h-full min-h-0 place-items-center rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 p-4">
        <ErrorState
          headline={copy.headline}
          subtitle={copy.subtitle}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {onBack ? (
                <Button size="sm" variant="ghost" onClick={onBack}>
                  Back to list
                </Button>
              ) : null}
              {onStartDaemon &&
              (error.code === "local_daemon_required" ||
                error.code === "canonical_memory_unavailable") ? (
                <Button size="sm" onClick={onStartDaemon}>
                  Start daemon
                </Button>
              ) : null}
              <Button
                size="sm"
                leadingIcon="ph:arrow-clockwise"
                onClick={() => void handleRefresh()}
              >
                Refresh
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  if (loading || detail === null) {
    return (
      <div
        className="h-full min-h-0 rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 p-4"
        aria-label="Loading canonical memory"
        aria-busy="true"
      >
        <SkeletonRows count={7} />
      </div>
    );
  }

  const canReveal =
    detail.id === memoryId &&
    detail.privacy.classification === "public" &&
    detail.privacy.revealRequired === false;
  const revealed = canReveal && revealedId === memoryId;

  return (
    <article className="flex h-full min-h-0 flex-col rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30">
      <header className="shrink-0 border-b border-[var(--border-hairline)] p-3">
        <div className="flex items-start gap-2">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to list"
              className="focus-ring inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              <Icon name="ph:arrow-left" width={13} aria-hidden />
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[length:var(--text-md)] font-semibold text-[var(--text-primary)]">
              {detail.title}
            </h3>
            <p className="mt-1 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
              Updated <time dateTime={detail.updatedAt}>{detail.updatedAt}</time>
            </p>
          </div>
          {canReveal && !revealed ? (
            <Button
              size="xs"
              leadingIcon="ph:key"
              onClick={() => setRevealedId(memoryId)}
            >
              Reveal
            </Button>
          ) : null}
          {revealed ? (
            <div
              className="inline-flex overflow-hidden rounded-[var(--radius-control)] border border-[var(--border-hairline)] text-[length:var(--text-2xs)]"
              aria-label="Memory view"
            >
              {(["rendered", "raw"] as const).map((nextMode) => (
                <button
                  key={nextMode}
                  type="button"
                  aria-pressed={mode === nextMode}
                  onClick={() => setMode(nextMode)}
                  className={`focus-ring-inset px-2 py-1 ${
                    mode === nextMode
                      ? "bg-[var(--accent-presence)]/15 text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                  }`}
                >
                  {nextMode === "rendered" ? "Rendered" : "Raw"}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[length:var(--text-2xs)] @min-[560px]/memview:grid-cols-4">
          <div>
            <dt className="text-[var(--text-muted)]">Source</dt>
            <dd className="truncate text-[var(--text-secondary)]">
              {detail.source.label}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Privacy</dt>
            <dd className="text-[var(--text-secondary)]">
              {detail.privacy.classification ?? "unclassified"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Verification</dt>
            <dd className="text-[var(--text-secondary)]">
              {detail.verification.state}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Attestation fields</dt>
            <dd className="text-[var(--text-secondary)]">
              {detail.attestationMetadata?.fieldCount ?? "Unavailable"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Supersedes</dt>
            <dd className="truncate text-[var(--text-secondary)]">
              {detail.supersession.supersedes ?? "None"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Superseded by</dt>
            <dd className="truncate text-[var(--text-secondary)]">
              {detail.supersession.supersededBy ?? "None"}
            </dd>
          </div>
        </dl>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {revealed ? (
          <CanonicalMemoryMarkdown
            content={detail.content}
            mode={mode}
            className={
              mode === "rendered"
                ? "cave-md canonical-memory-markdown"
                : "whitespace-pre-wrap break-words font-mono text-[length:var(--text-xs)] text-[var(--text-secondary)]"
            }
          />
        ) : canReveal ? (
          <EmptyState
            compact
            icon="ph:lock-simple"
            headline="Content hidden"
            subtitle="Review the privacy and verification metadata, then choose Reveal."
          />
        ) : (
          <EmptyState
            compact
            icon="ph:lock-simple"
            headline="Content remains hidden"
            subtitle={`${detail.privacy.reason} Canonical content can be shown only when classification is public and reveal is not required.`}
          />
        )}
      </div>
    </article>
  );
}
