"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import { IconButton } from "@/components/ui/icon-button";
import { useAnnouncer } from "@/components/ui/live-region";
import { useFocusTrap } from "@/lib/use-focus-trap";

/**
 * Event subscriptions modal for the GitHub surface: pick repos to watch and
 * which events (opened PRs, CI completions) land in the Cave notification
 * bell. Backed by /api/github/subscriptions; the server-side watcher
 * (`github-watcher.ts`) does the polling.
 */

type Prefs = {
  enabled: boolean;
  events: { prOpened: boolean; ciCompleted: boolean };
  repos: string[];
};

type Props = {
  /** Watcher polling needs a PAT — without one we render a hint instead. */
  hasPat: boolean;
  onConnectPat: () => void;
  onClose: () => void;
};

export function GithubSubscriptionsModal({ hasPat, onConnectPat, onClose }: Props) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [repoInput, setRepoInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const { announce } = useAnnouncer();

  useFocusTrap(true, dialogRef, { onEscape: onClose });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/github/subscriptions");
        const data = await res.json().catch(() => null);
        if (!cancelled && data?.ok) setPrefs(data.prefs as Prefs);
      } catch {
        if (!cancelled) setError("Could not load subscription settings.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch("/api/github/subscriptions", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          setError(data?.error ?? "Saving failed — please try again.");
          return false;
        }
        setPrefs(data.prefs as Prefs);
        return true;
      } catch {
        setError("Network error — please try again.");
        return false;
      }
    },
    [],
  );

  const addRepo = useCallback(async () => {
    const repo = repoInput.trim();
    if (!repo || !prefs) return;
    const ok = await patch({ repos: [...prefs.repos, repo] });
    if (ok) {
      setRepoInput("");
      announce(`Watching ${repo}`, "polite");
    }
  }, [repoInput, prefs, patch, announce]);

  const removeRepo = useCallback(
    async (repo: string) => {
      if (!prefs) return;
      const ok = await patch({ repos: prefs.repos.filter((r) => r !== repo) });
      if (ok) announce(`Stopped watching ${repo}`, "polite");
    },
    [prefs, patch, announce],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="github-subs-modal-title"
        onClick={(event) => event.stopPropagation()}
        className="gh-pat-dialog"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="ph:bell-ringing" width={18} className="text-[var(--text-secondary)]" />
            <h3 id="github-subs-modal-title" className="text-[length:var(--text-md)] font-semibold">
              Event subscriptions
            </h3>
          </div>
          <IconButton icon="ph:x" size="sm" aria-label="Close" onClick={onClose} />
        </div>

        <p className="mb-4 text-[length:var(--text-sm)] text-[var(--text-muted)]">
          Get a Cave notification when things happen in repos you watch — new PRs
          opened, CI runs finishing. Checked every minute, delivered to the bell.
        </p>

        {!hasPat ? (
          <div className="mb-4 flex flex-col gap-2">
            <p className="text-[length:var(--text-sm)] text-[var(--text-secondary)]">
              Watching repos needs a GitHub PAT — polling spends API quota the
              public rate limit can’t cover.
            </p>
            <Button size="xs" variant="primary" leadingIcon="ph:key" onClick={onConnectPat}>
              Connect PAT first
            </Button>
          </div>
        ) : !prefs ? (
          <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">Loading…</p>
        ) : (
          <>
            <label className="mb-3 flex items-center gap-2 text-[length:var(--text-base)]">
              <input
                type="checkbox"
                checked={prefs.enabled}
                onChange={(e) => void patch({ enabled: e.target.checked })}
              />
              <span>Subscriptions on</span>
            </label>

            <div className="mb-4 flex flex-col gap-1.5 pl-1">
              <label className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  disabled={!prefs.enabled}
                  checked={prefs.events.prOpened}
                  onChange={(e) => void patch({ events: { prOpened: e.target.checked } })}
                />
                <span>PRs opened</span>
              </label>
              <label className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  disabled={!prefs.enabled}
                  checked={prefs.events.ciCompleted}
                  onChange={(e) => void patch({ events: { ciCompleted: e.target.checked } })}
                />
                <span>CI completed (success or failure)</span>
              </label>
            </div>

            <div className="mb-2 text-[length:var(--text-xs)] font-medium text-[var(--text-secondary)]">
              Watched repos
            </div>
            <form
              className="mb-2 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void addRepo();
              }}
            >
              <input
                type="text"
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                placeholder="owner/repo"
                aria-label="Repository to watch"
                className="gh-input"
              />
              <Button size="xs" variant="secondary" type="submit" disabled={!repoInput.trim()}>
                Watch
              </Button>
            </form>

            {prefs.repos.length === 0 ? (
              <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
                No repos watched yet — add one above.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {prefs.repos.map((repo) => (
                  <li
                    key={repo}
                    className="flex items-center justify-between gap-2 text-[length:var(--text-sm)]"
                  >
                    <span className="truncate font-mono">{repo}</span>
                    <IconButton
                      icon="ph:x"
                      size="sm"
                      aria-label={`Stop watching ${repo}`}
                      title={`Stop watching ${repo}`}
                      onClick={() => void removeRepo(repo)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="mt-3 text-[length:var(--text-sm)] text-[var(--color-danger)]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
