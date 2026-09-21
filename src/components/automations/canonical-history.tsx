"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CronDetailSection } from "@/components/automations/cron-detail-primitives";
import { parseAutomationHistory, type AutomationHistoryResult } from "@/lib/automations/history";

type HistoryPage = Extract<AutomationHistoryResult, { kind: "available" }>;
const failures = {
  invalid: "This history request is invalid. Start again to read the current history.",
  expired: "The history checkpoint expired. Start again to read the retained history.",
  unsupported: "This daemon does not provide canonical history. Check its version and capabilities, then retry.",
  unavailable: "Couldn't read history. Check the daemon connection, then retry.",
};

function HistoryPageView({ automationId }: { automationId: string }) {
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [failure, setFailure] = useState<keyof typeof failures | null>(null);
  const [loading, setLoading] = useState(false);
  const active = useRef<AbortController | null>(null);

  async function load(checkpoint?: string) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setFailure(null);
    try {
      const query = checkpoint === undefined ? "" : `?${new URLSearchParams({ checkpoint })}`;
      const response = await fetch(`/api/coven-automations/${encodeURIComponent(automationId)}/events${query}`, {
        cache: "no-store", signal: controller.signal,
      });
      const result = parseAutomationHistory(await response.json());
      if (controller.signal.aborted) return;
      if (result.kind === "available" && response.ok) {
        setPage(result);
      } else {
        setFailure(result.kind !== "available" && Object.hasOwn(failures, result.kind) ? result.kind : "unavailable");
      }
    } catch {
      if (!controller.signal.aborted) setFailure("unavailable");
    } finally {
      if (!controller.signal.aborted) { active.current = null; setLoading(false); }
    }
  }

  useEffect(() => {
    void load();
    return () => { active.current?.abort(); active.current = null; };
    // The owner keys this component by automation ID; closing it aborts the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="space-y-3 text-[length:var(--text-xs)] text-[var(--text-secondary)]" aria-busy={loading}>
    <p>Recorded events, read on demand. This history does not establish current execution or approval authority.</p>
    {loading && <p role="status">Reading history…</p>}
    {failure && <p role="alert">{failures[failure]}{page ? " Previously read history below is stale." : ""}</p>}
    {page && <>
      <p>Read at <time dateTime={page.readAt}>{page.readAt}</time>.</p>
      {page.entries.length > 0 ? <ol className="space-y-3">
        {page.entries.map(entry => <li key={entry.id} className="min-w-0 break-words">
          <p className="font-medium text-[var(--text-primary)]">{entry.label}</p>
          <p>{entry.detail}</p>
          <time dateTime={entry.recordedAt}>{entry.recordedAt}</time>
          <p className="font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]">Event {entry.id} · sequence {entry.sequence}</p>
        </li>)}
      </ol> : <p role="status">{page.withheld ? "No displayable entries on this page." : "No newer events. Check again to read subsequent events."}</p>}
      {page.withheld > 0 && <p>{page.withheld} protected {page.withheld === 1 ? "entry omitted" : "entries omitted"}.</p>}
      <p>One page is shown at a time, in recorded sequence.</p>
    </>}
    <div className="flex flex-wrap gap-2">
      <Button size="xs" disabled={loading} onClick={() => void load()}>Start again</Button>
      {failure !== "expired" && <Button size="xs" disabled={loading} onClick={() => void load(page?.checkpoint)}>
        {page ? "Check for newer events" : "Retry"}
      </Button>}
    </div>
  </div>;
}

export function CanonicalAutomationHistory({ automationId }: { automationId: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <CronDetailSection title="Coven history">
    <Button size="sm" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      {open ? "Hide history" : "Read history"}
    </Button>
    <div id={id}>{open && <HistoryPageView key={automationId} automationId={automationId} />}</div>
  </CronDetailSection>;
}
