"use client";
// Thread pane (spec §3 routes 2-3 rendering): opens a weave and shows its
// threads — tension (Holds / Frayed / Snapped, plus the UI-only blocked and
// stale treatments), strand list, and channel bindings. A thread here is one
// authority relationship, surface → writer; the copy keeps that referent.
//
// Threads are an accordion ordered worst-first: the closed row carries the
// verdict and its consequence, the open row carries the evidence (strands,
// diff, ward.audit lineage) directly underneath, so a fray is never explained
// somewhere other than where it is named.
import { Icon } from "@/lib/icon";
import { StatusPill } from "@/components/weave-rail";
import { StrandInspector } from "@/components/strand-inspector";
import { channelLabel, paneModel, pillForTension } from "@/lib/weave-rail";
import type { ThreadView, WeaveDetail } from "@/lib/threads-read";

function ChannelChips({ thread }: { thread: ThreadView }) {
  if (thread.holdsUnder.length === 0) {
    return (
      <span className="wv-chips__none">covers no channels — every mutation fails closed</span>
    );
  }
  return (
    <>
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
            className="wv-chip"
          >
            <Icon name="ph:waveform" aria-hidden />
            {channelLabel(channel)}
          </span>
        );
      })}
    </>
  );
}

/** The consequence of this thread's tension, stated where the pill is. */
function threadVerdict(thread: ThreadView): { tone: string; icon: "ph:warning" | "ph:x-circle" | "ph:shield-slash"; text: string } | null {
  const tension = thread.tension;
  if (tension.state === "frayed") {
    return {
      tone: "wv-verdict--frayed",
      icon: "ph:warning",
      text: `Frayed at ${tension.strand ?? "a missing required strand"} on ${
        tension.channel ? channelLabel(tension.channel) : "an unrecognized channel"
      } (${tension.reason.kind}) — repairable; inspect the strand below for the current-vs-expected diff. Writes to this surface degrade to proposals until a predicate passes.`,
    };
  }
  if (tension.state === "snapped") {
    return {
      tone: "wv-verdict--snapped",
      icon: "ph:x-circle",
      text: `Snapped (${tension.reason.kind}) — ${thread.surface} is read-only until a fresh authority ceremony.`,
    };
  }
  if (tension.state === "unknown") {
    return {
      tone: "wv-verdict--blocked",
      icon: "ph:shield-slash",
      text: "Cannot verify this thread — rendered blocked. No write through it will be treated as authorized.",
    };
  }
  return null;
}

export function ThreadPane({
  weave,
  openThreadId,
  stagedThreadIds,
  knownProposalIds,
  onToggleThread,
  onTraceThread,
  onOpenProposal,
}: {
  weave: WeaveDetail;
  openThreadId: string | null;
  /** Threads with a staged write awaiting a decision, from /api/proposals. */
  stagedThreadIds: ReadonlySet<string>;
  knownProposalIds: ReadonlySet<string>;
  onToggleThread: (id: string) => void;
  onTraceThread: (thread: ThreadView) => void;
  onOpenProposal: (threadId: string) => void;
}) {
  const model = paneModel(weave);
  return (
    <section aria-label="Threads" className="wv-section--ruled">
      <div className="wv-section__head">
        <h3 className="wv-eyebrow">Threads — worst first</h3>
        <span className="wv-section__aside">
          One thread binds one protected surface to one writer
        </span>
      </div>
      <ul className="wv-threads">
        {model.threads.map((thread) => {
          const open = thread.id === openThreadId;
          const verdict = threadVerdict(thread);
          const staged = stagedThreadIds.has(thread.id);
          return (
            <li key={thread.id} className={`wv-thread${open ? " wv-thread--open" : ""}`}>
              <button
                type="button"
                className="wv-thread__btn focus-ring-inset"
                aria-expanded={open}
                onClick={() => onToggleThread(thread.id)}
              >
                <span className="wv-thread__line">
                  <Icon name="ph:caret-right" className="wv-thread__caret" aria-hidden />
                  <span className="wv-thread__ident">
                    <span className="wv-thread__surface">{thread.surface}</span>
                    <span className="wv-thread__arrow" aria-label="written by">
                      →
                    </span>
                    <span className="wv-thread__writer">{thread.writer}</span>
                  </span>
                  <span className="wv-thread__count">
                    {thread.strandCount} strand{thread.strandCount === 1 ? "" : "s"} of commitment
                  </span>
                  <StatusPill pill={pillForTension(thread.tension)} />
                </span>
                {open ? (
                  <span className="wv-chips">
                    <ChannelChips thread={thread} />
                  </span>
                ) : null}
                {verdict ? (
                  <span className={`wv-verdict ${verdict.tone}`}>
                    <Icon name={verdict.icon} aria-hidden />
                    <span>{verdict.text}</span>
                  </span>
                ) : null}
              </button>

              {staged ? (
                <div className="wv-thread__cta">
                  <p>A write to this surface is staged and waiting on your decision.</p>
                  <button
                    type="button"
                    className="wv-cta wv-cta--sm focus-ring"
                    onClick={() => onOpenProposal(thread.id)}
                  >
                    Review it
                    <Icon name="ph:caret-right" aria-hidden />
                  </button>
                </div>
              ) : null}

              {open ? (
                <StrandInspector
                  thread={thread}
                  knownProposalIds={knownProposalIds}
                  onTraceThread={() => onTraceThread(thread)}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
