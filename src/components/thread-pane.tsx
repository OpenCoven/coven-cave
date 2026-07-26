"use client";
// Thread pane (spec §3 routes 2-3 rendering): opens a weave and shows its
// threads — tension (Holds / Frayed / Snapped, plus the UI-only blocked and
// stale treatments), strand list, and channel bindings. A thread here is one
// authority relationship, surface → writer; the copy keeps that referent.
import { Icon } from "@/lib/icon";
import { StatusPill } from "@/components/weave-rail";
import {
  channelLabel,
  paneModel,
  pillForCoherence,
  pillForTension,
  shortHash,
} from "@/lib/weave-rail";
import type { ThreadsMeta, ThreadView, WeaveDetail } from "@/lib/threads-read";

function ChannelChips({ thread }: { thread: ThreadView }) {
  if (thread.holdsUnder.length === 0) {
    return (
      <span className="text-xs text-[var(--text-muted)]">
        covers no channels — every mutation fails closed
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      {thread.holdsUnder.map((channel) => {
        const required = thread.requiredStrands[channel] ?? [];
        return (
          <span
            key={channel}
            title={
              required.length > 0
                ? `Holding under ${channelLabel(channel)} requires: ${required.join(", ")}`
                : `${channelLabel(channel)} has no structural strand floor`
            }
            className="inline-flex items-center gap-1 rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-[length:var(--text-2xs)] text-[var(--text-muted)]"
          >
            <Icon name="ph:waveform" aria-hidden />
            {channelLabel(channel)}
          </span>
        );
      })}
    </span>
  );
}

export function ThreadPane({
  weave,
  meta,
  selectedThreadId,
  onSelectThread,
  onTraceThread,
}: {
  weave: WeaveDetail;
  meta: ThreadsMeta;
  selectedThreadId: string | null;
  onSelectThread: (id: string) => void;
  onTraceThread: (thread: ThreadView) => void;
}) {
  const model = paneModel(weave);
  const coherencePill = pillForCoherence(weave.coherence);
  return (
    <section aria-label="Thread pane" className="flex min-w-0 flex-col gap-3">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {weave.familiarId} · weave {shortHash(weave.weaveHash)}
          </h2>
          <p className="text-xs text-[var(--text-muted)]">
            An enforced pattern of {weave.threadCount} thread{weave.threadCount === 1 ? "" : "s"} —
            each one an authority relationship, surface → writer.
          </p>
        </div>
        <StatusPill pill={coherencePill} />
      </header>

      {weave.patternDescriptor ? (
        <aside
          aria-label="Pattern descriptor (derived)"
          className="rounded border border-dashed border-[var(--border-hairline)] px-2 py-1.5 text-xs text-[var(--text-muted)]"
        >
          <span className="mr-1 inline-flex items-center gap-1 rounded bg-[var(--bg-raised)] px-1 py-0.5 text-[length:var(--text-2xs)] uppercase tracking-wide">
            <Icon name="ph:info" aria-hidden />
            derived
          </span>
          Pattern “{weave.patternDescriptor.name}” names {weave.patternDescriptor.protectedSurfaces.join(", ") || "no surfaces"} —
          a summary for legibility, never what decided. The verdicts above come from the predicate.
        </aside>
      ) : null}

      <ul className="flex flex-col gap-1">
        {model.threads.map((thread) => {
          const pill = pillForTension(thread.tension);
          const selected = thread.id === selectedThreadId;
          return (
            <li
              key={thread.id}
              className={`rounded border-l-2 px-2 py-2 ${
                selected
                  ? "border-[var(--accent-presence)] bg-[var(--bg-raised)]/60"
                  : "border-transparent hover:bg-[var(--bg-raised)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onSelectThread(thread.id)}
                  aria-current={selected ? "true" : undefined}
                  className="focus-ring-inset min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm text-[var(--text-primary)]">
                    {thread.surface} <span className="text-[var(--text-muted)]">→</span> {thread.writer}
                  </span>
                  <span className="block text-xs text-[var(--text-muted)]">
                    {thread.strandCount} strand{thread.strandCount === 1 ? "" : "s"} of commitment
                    {thread.createdAt ? ` · woven ${thread.createdAt}` : ""}
                  </span>
                </button>
                <StatusPill
                  pill={pill}
                  onTrace={() => onTraceThread(thread)}
                  traceLabel={`Trace ${thread.surface} tension to source`}
                />
              </div>
              <div className="mt-1">
                <ChannelChips thread={thread} />
              </div>
              {thread.tension.state === "frayed" ? (
                <p className="mt-1 text-xs text-[var(--color-warning)]">
                  Frayed at {thread.tension.strand ?? "a missing required strand"} on{" "}
                  {thread.tension.channel ?? "an unrecognized channel"} ({thread.tension.reason.kind}) —
                  repairable; inspect the strand for the current-vs-expected diff.
                </p>
              ) : null}
              {thread.tension.state === "snapped" ? (
                <p className="mt-1 text-xs text-[var(--color-danger)]">
                  Snapped ({thread.tension.reason.kind}) — read-only until a fresh authority ceremony.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <footer className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">
        observed {meta.observedAt} · cursor {meta.sourceCursor}
      </footer>
    </section>
  );
}
