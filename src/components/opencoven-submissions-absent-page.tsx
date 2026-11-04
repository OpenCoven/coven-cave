"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useAnnouncer } from "@/components/ui/live-region";

type Summary = { ok: true; exists: boolean; count: number | null } | { ok: false; error?: string };

const RETAINED = "/api/opencoven/submissions/retained";

/**
 * What the `submissions` mode shows in a build without the optional
 * implementation (#6401). Saved links land here rather than on a dead page, and
 * saved submissions stay exportable and deletable.
 */
export function OpenCovenSubmissionPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { announce } = useAnnouncer();

  useEffect(() => {
    const controller = new AbortController();
    fetch(RETAINED, { cache: "no-store", signal: controller.signal })
      .then((res) => res.json() as Promise<Summary>)
      .then(setSummary)
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setSummary({ ok: false, error: reason instanceof Error ? reason.message : undefined });
      });
    return () => controller.abort();
  }, []);

  const deleteSaved = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${RETAINED}?confirm=delete`, { method: "DELETE" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Saved submissions couldn't be deleted.");
      setSummary({ ok: true, exists: false, count: 0 });
      setConfirming(false);
      announce("Saved submissions deleted.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Saved submissions couldn't be deleted.";
      setError(message);
      announce(message, "assertive");
    } finally {
      setBusy(false);
    }
  };

  // Through fetch, not a download link: the packaged shell adds its credential
  // to fetches, and this route refuses a navigation that doesn't carry it.
  const exportSaved = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${RETAINED}?download=1`, { cache: "no-store" });
      if (!res.ok) throw new Error("Saved submissions couldn't be exported.");
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "opencoven-submissions.json";
      link.click();
      URL.revokeObjectURL(url);
      announce("Saved submissions exported.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Saved submissions couldn't be exported.";
      setError(message);
      announce(message, "assertive");
    } finally {
      setBusy(false);
    }
  };

  const hasSaved = summary?.ok === true && summary.exists;
  const savedLine = !summary
    ? "Checking for saved submissions…"
    : !summary.ok
      ? "Couldn't check for saved submissions. Try reopening this page."
      : !summary.exists
        ? "You have no saved submissions."
        : summary.count === null
          ? "Your saved submissions file is kept, and comes back if Submissions is reinstalled."
          : `${summary.count} saved ${summary.count === 1 ? "submission is" : "submissions are"} kept, and come back if Submissions is reinstalled.`;

  return (
    <section className="flex h-full items-center justify-center p-6" aria-label="Submissions">
      <EmptyState
        icon="ph:storefront-bold"
        headline="Submissions isn't included in this build"
        subtitle={error ?? savedLine}
        actions={hasSaved ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => void exportSaved()}>Export</Button>
            {confirming ? (
              <>
                <Button variant="danger" disabled={busy} onClick={() => void deleteSaved()}>Delete saved submissions</Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirming(true)}>Delete…</Button>
            )}
          </>
        ) : undefined}
      />
    </section>
  );
}
