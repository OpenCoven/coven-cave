"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { InlineAsanaPATSetup } from "@/components/asana-connect-inline";
import { useAnnouncer } from "@/components/ui/live-region";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import {
  createBoardCardFromAsanaItem,
  fileAsanaItemAsBead,
  type AsanaAssignedResponse,
  type AsanaItem,
} from "@/lib/asana-tasks";

// Content equality for the poll — the assigned list is a plain object graph, so a
// serialized compare is exact. Keeping the previous array identity on a no-change
// poll stops the 30s tick from re-rendering every row for an identical picture
// (same discipline as the parent Queue's sameQueue guard).
function sameItems(a: AsanaItem[], b: AsanaItem[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type Props = {
  onOpenUrl?: (url: string) => void;
  /** Nudge the parent Queue to reload after a task is filed as a bead so it
   *  appears in the ready lanes without waiting for the next poll. */
  onFiledBead?: () => void;
  /** Scope the strip to one agent: shows only the Asana tasks that familiar is
   *  assigned to work with, and hides entirely when the agent is opted out. */
  familiarId?: string | null;
};

/**
 * The Queue's Asana source: incomplete tasks assigned to the connected user,
 * pulled from /api/asana/assigned. Renders NOTHING when Asana isn't connected
 * or there are no tasks — the Queue's other sources (beads + PRs) stand alone,
 * so an absent Asana connection must not add a banner or empty state here. Each
 * task can be opened in Asana, added to the board, or filed as a bead (entering
 * the ready queue via --external-ref).
 */
export function AsanaQueueStrip({ onOpenUrl, onFiledBead, familiarId }: Props) {
  const { announce } = useAnnouncer();
  const [items, setItems] = useState<AsanaItem[]>([]);
  const [configured, setConfigured] = useState(false);
  const [patInvalid, setPatInvalid] = useState(false);
  const [reconnectOpen, setReconnectOpen] = useState(false);
  const [busyGid, setBusyGid] = useState<string | null>(null);
  const [filed, setFiled] = useState<Set<string>>(() => new Set());
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const url = familiarId
        ? `/api/asana/assigned?familiarId=${encodeURIComponent(familiarId)}`
        : "/api/asana/assigned";
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      const data = (await res.json()) as AsanaAssignedResponse;
      if (ctrl.signal.aborted) return;
      // A failed fetch, unconfigured Asana, or an agent opted out (assigned ===
      // false) leaves the strip hidden — never an error banner; the Queue's
      // beads/PR sources carry the surface on their own. The one exception is a
      // REJECTED token (patInvalid): that's permanent-until-fixed, and hiding it
      // made the strip vanish with no cue or way back (cave-d6zq).
      if (data.ok && data.configured && data.assigned !== false) {
        const next = Array.isArray(data.items) ? data.items : [];
        setItems((prev) => (sameItems(prev, next) ? prev : next));
        setConfigured(true);
        setPatInvalid(false);
      } else {
        setItems((prev) => (prev.length === 0 ? prev : []));
        setConfigured(false);
        setPatInvalid(data.patInvalid === true);
      }
    } catch {
      if (!ctrl.signal.aborted) {
        setItems([]);
        setConfigured(false);
      }
    }
  }, [familiarId]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  // Refresh on the same 30s cadence as the Queue's beads/PR lanes so a task
  // completed or reassigned in Asana doesn't linger here until remount. Paused
  // while an input is focused and while the tab is hidden (usePausablePoll);
  // kept at 30s — not tighter — to respect Asana's REST rate limits.
  usePausablePoll(() => void load(), 30_000, { pauseWhileInputActive: true });

  const addToBoard = useCallback(
    async (item: AsanaItem) => {
      setBusyGid(item.gid);
      try {
        const res = await createBoardCardFromAsanaItem(item, null);
        announce(res.ok ? `Added "${item.title}" to Tasks.` : `Couldn't add to Tasks: ${res.error}`, res.ok ? "polite" : "assertive");
      } finally {
        setBusyGid(null);
      }
    },
    [announce],
  );

  const fileBead = useCallback(
    async (item: AsanaItem) => {
      setBusyGid(item.gid);
      try {
        const res = await fileAsanaItemAsBead(item);
        if (res.ok) {
          setFiled((prev) => new Set(prev).add(item.gid));
          announce(res.beadId ? `Filed ${res.beadId} from "${item.title}".` : `Filed a bead from "${item.title}".`);
          onFiledBead?.();
        } else {
          announce(`Couldn't file a bead: ${res.error}`, "assertive");
        }
      } finally {
        setBusyGid(null);
      }
    },
    [announce, onFiledBead],
  );

  if (patInvalid) {
    return (
      <section className="fwq-asana" aria-label="Asana connection">
        <header className="fwq-asana-head">
          <Icon name="ph:check-circle" width={14} aria-hidden />
          <span className="fwq-asana-title">Asana</span>
          <span className="fwq-asana-summary">token expired — assigned tasks are hidden</span>
          <Button
            variant="ghost"
            size="xs"
            leadingIcon="ph:plugs"
            onClick={() => setReconnectOpen((v) => !v)}
          >
            {reconnectOpen ? "Cancel" : "Reconnect"}
          </Button>
        </header>
        {reconnectOpen && (
          <InlineAsanaPATSetup
            onSaved={() => {
              setReconnectOpen(false);
              setPatInvalid(false);
              announce("Asana reconnected.");
              void load();
            }}
          />
        )}
      </section>
    );
  }

  if (!configured || items.length === 0) return null;

  return (
    <section className="fwq-asana" aria-label="Asana tasks assigned to you">
      <header className="fwq-asana-head">
        <Icon name="ph:check-circle" width={14} aria-hidden />
        <span className="fwq-asana-title">Asana</span>
        <span className="fwq-asana-summary">{items.length} assigned</span>
      </header>
      <ul className="fwq-asana-list">
        {items.map((item) => {
          const busy = busyGid === item.gid;
          const meta = [item.projectName, item.dueOn ? `due ${item.dueOn}` : null].filter(Boolean).join(" · ");
          return (
            <li key={item.gid} className="fwq-asana-item">
              <div className="fwq-asana-main">
                <span className="fwq-asana-name">{item.title}</span>
              </div>
              <div className="fwq-asana-tags">
                {meta ? <span className="fwq-tag">{meta}</span> : null}
                {filed.has(item.gid) ? <span className="fwq-tag fwq-tag--ready">filed</span> : null}
              </div>
              <Button
                variant="ghost"
                size="xs"
                trailingIcon="ph:arrow-square-out"
                onClick={() => onOpenUrl?.(item.url)}
                disabled={!onOpenUrl}
              >
                Open
              </Button>
              <Button
                variant="ghost"
                size="xs"
                leadingIcon="ph:plus"
                loading={busy}
                onClick={() => void addToBoard(item)}
                title="Create a task card from this Asana task"
              >
                Tasks
              </Button>
              <Button
                variant="secondary"
                size="xs"
                leadingIcon="ph:git-branch"
                loading={busy}
                disabled={filed.has(item.gid)}
                onClick={() => void fileBead(item)}
                title="File this task as a bead (enters the ready queue)"
              >
                {filed.has(item.gid) ? "Filed" : "File bead"}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
