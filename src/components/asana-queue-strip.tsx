"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  createBoardCardFromAsanaItem,
  fileAsanaItemAsBead,
  type AsanaAssignedResponse,
  type AsanaItem,
} from "@/lib/asana-tasks";

type Props = {
  onOpenUrl?: (url: string) => void;
  /** Nudge the parent Queue to reload after a task is filed as a bead so it
   *  appears in the ready lanes without waiting for the next poll. */
  onFiledBead?: () => void;
};

/**
 * The Queue's Asana source: incomplete tasks assigned to the connected user,
 * pulled from /api/asana/assigned. Renders NOTHING when Asana isn't connected
 * or there are no tasks — the Queue's other sources (beads + PRs) stand alone,
 * so an absent Asana connection must not add a banner or empty state here. Each
 * task can be opened in Asana, added to the board, or filed as a bead (entering
 * the ready queue via --external-ref).
 */
export function AsanaQueueStrip({ onOpenUrl, onFiledBead }: Props) {
  const { announce } = useAnnouncer();
  const [items, setItems] = useState<AsanaItem[]>([]);
  const [configured, setConfigured] = useState(false);
  const [busyGid, setBusyGid] = useState<string | null>(null);
  const [filed, setFiled] = useState<Set<string>>(() => new Set());
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/asana/assigned", { cache: "no-store", signal: ctrl.signal });
      const data = (await res.json()) as AsanaAssignedResponse;
      if (ctrl.signal.aborted) return;
      // A failed fetch or unconfigured Asana leaves the strip hidden — never an
      // error banner; the Queue's beads/PR sources carry the surface on their own.
      if (data.ok && data.configured) {
        setItems(Array.isArray(data.items) ? data.items : []);
        setConfigured(true);
      } else {
        setItems([]);
        setConfigured(false);
      }
    } catch {
      if (!ctrl.signal.aborted) {
        setItems([]);
        setConfigured(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const addToBoard = useCallback(
    async (item: AsanaItem) => {
      setBusyGid(item.gid);
      try {
        const res = await createBoardCardFromAsanaItem(item, null);
        announce(res.ok ? `Added "${item.title}" to the board.` : `Couldn't add to board: ${res.error}`, res.ok ? "polite" : "assertive");
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
                title="Create a board card from this task"
              >
                Board
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
