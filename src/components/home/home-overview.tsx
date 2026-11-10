"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { Icon } from "@/lib/icon";
import { formatTimestamp, useDateTimePrefs } from "@/lib/datetime-format";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { homeOverviewFreshness, homeOverviewRows, homeOverviewSessionState, HOME_OVERVIEW_STALE_MS, type HomeOverviewObservation, type HomeConnectionObservation } from "@/lib/home-overview";
import type { CaveProject } from "@/lib/cave-projects-types";
import type { Familiar, SessionRow } from "@/lib/types";
import "@/styles/home-overview.css";

type Props = {
  sessions: readonly SessionRow[];
  observation: HomeOverviewObservation;
  connection: HomeConnectionObservation | null;
  scopeFamiliarId: string | null;
  dataScopeFamiliarId: string | null | undefined;
  familiarIds: readonly string[];
  familiars: readonly Pick<Familiar, "id" | "display_name">[];
  project: CaveProject | null;
  onOpenSession: (sessionId: string, familiarId: string | null) => void;
  onOpenSessions: () => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
};

const OBSERVATION_COPY = {
  loading: "Checking this scope’s session list…",
  current: "Session list received",
  partial: "Partial session list. Some observations are unavailable.",
  stale: "Last-known session list. Refresh is delayed or failed.",
  unavailable: "Session list unavailable. Attention and work cannot be confirmed.",
};

function closeOnEscape(event: KeyboardEvent<HTMLDetailsElement>) {
  if (event.key !== "Escape" || !event.currentTarget.open) return false;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.open = false;
  event.currentTarget.querySelector("summary")?.focus();
  return true;
}

export function HomeOverview(props: Props) {
  const id = useId();
  const dateTimePrefs = useDateTimePrefs();
  const tick = useMinuteTick();
  const now = useMemo(() => Date.now(), [tick, props.observation.checkedAt, props.connection?.checkedAt]);
  const freshness = homeOverviewFreshness(props.observation, props.scopeFamiliarId, now);
  const rows = homeOverviewRows({ ...props, projectRoot: props.project?.root ?? null });
  const scopeMatches = props.observation.scopeFamiliarId === props.scopeFamiliarId;
  const names = new Map(props.familiars.map((familiar) => [familiar.id, familiar.display_name]));
  const context = props.familiarIds.length ? props.familiarIds.map((key) => names.get(key) ?? key).join(", ") : "All familiars in this session list";
  const connection = props.connection;
  const connectionAge = connection ? now - Date.parse(connection.checkedAt) : NaN;
  const connectionOld = connection && (connectionAge >= HOME_OVERVIEW_STALE_MS || connectionAge < -HOME_OVERVIEW_STALE_MS);
  const connectionLabel = !connection ? "Connection not checked"
    : connectionOld ? "Connection check is stale"
      : connection.result.kind === "running" ? `${connection.result.targetMode === "hub" ? "Hub" : "Local Coven"} connection reported running`
        : connection.result.kind === "transitioning" ? `Daemon ${connection.result.state}`
          : connection.result.kind === "offline" ? "Local Coven daemon is offline"
            : connection.result.kind === "auth-expired" ? "Connection access must be checked" : "Connection status unavailable";

  // A status change may move a row between sections. Restore its focused
  // trigger only if React removed that exact node; never steal another focus.
  const focused = useRef<{ key: string; node: HTMLElement } | null>(null);
  const buttons = useRef(new Map<string, HTMLElement>());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  useLayoutEffect(() => {
    const previous = focused.current;
    if (previous && !previous.node.isConnected && document.activeElement === document.body) {
      const button = buttons.current.get(previous.key);
      if (!button) { focused.current = null; return; }
      const more = button.closest<HTMLDetailsElement>("details.home-overview__more");
      if (more) more.open = true;
      button.focus({ preventScroll: true });
    }
  });

  function renderRow(row: SessionRow) {
    const state = homeOverviewSessionState(row);
    const summaryKey = JSON.stringify([row.id, "summary"]);
    const openKey = JSON.stringify([row.id, "open"]);
    return <li key={row.id} className="home-overview__item">
      <details open={expanded.has(row.id)} onToggle={(event) => {
        const open = event.currentTarget.open;
        setExpanded((previous) => {
          if (previous.has(row.id) === open) return previous;
          const next = new Set(previous);
          if (open) next.add(row.id); else next.delete(row.id);
          return next;
        });
      }} onKeyDown={(event) => {
        if (!closeOnEscape(event)) return;
        setExpanded((previous) => { const next = new Set(previous); next.delete(row.id); return next; });
      }}>
      <summary className="home-overview__row focus-ring" data-home-session={row.id}
        ref={(node) => { if (node) buttons.current.set(summaryKey, node); else buttons.current.delete(summaryKey); }}
        onFocus={(event) => { focused.current = { key: summaryKey, node: event.currentTarget }; }}
        onBlur={(event) => { if (event.relatedTarget || event.currentTarget.isConnected) focused.current = null; }}>
        <Icon name={state.icon} width={16} aria-hidden />
        <span className="home-overview__body"><span className="home-overview__title">{row.title || "Untitled session"}</span>
          <span className="home-overview__meta">{row.familiarId ? names.get(row.familiarId) ?? row.familiarId : "Familiar not recorded"} · {state.label} · <RelativeTime iso={row.updated_at} now={now} fallback="Update time not reported" /></span>
        </span>
        <span className="home-overview__hint">Details</span>
        <Icon name="ph:caret-right" width={12} aria-hidden />
      </summary>
      <div className="home-overview__references">
        <dl><dt>Session</dt><dd><code>{row.id}</code></dd><dt>Familiar reference</dt><dd><code>{row.familiarId || "Not recorded"}</code></dd><dt>Project root</dt><dd><code>{row.project_root || "Not recorded"}</code></dd><dt>Governed identity revision</dt><dd>Not supplied by this session list</dd></dl>
        <Button variant="ghost" aria-label={`Open conversation: ${row.title || "Untitled session"}`}
          ref={(node) => { if (node) buttons.current.set(openKey, node); else buttons.current.delete(openKey); }}
          onFocus={(event) => { focused.current = { key: openKey, node: event.currentTarget }; }} onBlur={(event) => { if (event.relatedTarget || event.currentTarget.isConnected) focused.current = null; }}
          onClick={() => props.onOpenSession(row.id, row.familiarId ?? null)}>Open conversation</Button>
      </div>
      </details>
    </li>;
  }

  function group(key: string, title: string, items: readonly SessionRow[], empty: string) {
    return <section className="home-overview__group" aria-labelledby={`${id}-${key}`}>
      <h3 id={`${id}-${key}`}>{title}{items.length ? <span> · {items.length}</span> : null}</h3>
      {items.length ? <><ul>{items.slice(0, 3).map(renderRow)}</ul>{items.length > 3 ? <details className="home-overview__more" onKeyDown={closeOnEscape}><summary className="focus-ring">{items.length - 3} more observations</summary><ul>{items.slice(3).map(renderRow)}</ul></details> : null}</>
        : <p className="home-overview__empty">{empty}</p>}
    </section>;
  }

  const canConfirmEmpty = freshness === "current" && rows.unbound === 0 && ![...rows.attention, ...rows.running, ...rows.outcomes, ...rows.elsewhere].some((row) => homeOverviewSessionState(row).key === "unknown");
  return <section className="home-overview" aria-labelledby={`${id}-title`} data-observation={freshness}>
    <header className="home-overview__header"><div><h2 id={`${id}-title`}>Overview</h2><p>{context} · {props.project?.name ?? "All projects in this session list"}</p></div>
      <Button variant="ghost" onClick={props.onOpenSessions}>Conversations</Button>
    </header>
    <div className="home-overview__freshness">
      <p>{scopeMatches && props.observation.accessDenied ? "Session access must be checked. Previous observations are hidden." : OBSERVATION_COPY[freshness]}{scopeMatches && props.observation.checkedAt ? <> · <time dateTime={props.observation.checkedAt}>{formatTimestamp(props.observation.checkedAt, dateTimePrefs)}</time></> : null}</p>
      <p>{connectionLabel}{connection ? <> · checked <time dateTime={connection.checkedAt}>{formatTimestamp(connection.checkedAt, dateTimePrefs)}</time></> : null}</p>
      <div><Button variant="ghost" onClick={props.onRefresh}>Refresh observations</Button><Button variant="ghost" onClick={props.onOpenSettings}>Connection settings</Button></div>
    </div>
    <details className="home-overview__references" onKeyDown={closeOnEscape}><summary className="focus-ring">Context and observation limits</summary>
      <dl><dt>Familiar references</dt><dd><code>{props.familiarIds.length ? props.familiarIds.join(", ") : "All references in the authorized session list"}</code></dd><dt>Project root</dt><dd><code>{props.project?.root ?? "All projects in this session list"}</code></dd><dt>Instance binding</dt><dd>Not supplied by this connection status view</dd></dl>
    </details>
    {rows.unbound ? <p className="home-overview__note">Some observations lack familiar or project references. This view cannot confirm complete identity or attention coverage.</p> : null}
    {group("attention", "Needs you", rows.attention, canConfirmEmpty ? "No reported decisions, blocks or failures in this scope." : "Attention cannot be confirmed from the available observations.")}
    {rows.elsewhere.length ? group("elsewhere", "Needs you in other permitted projects", rows.elsewhere, "") : null}
    {group("running", "Reported work", rows.running, canConfirmEmpty ? "No running sessions reported in this scope." : "Current work cannot be confirmed from this view.")}
    {group("outcomes", "Recent observations", rows.outcomes, canConfirmEmpty ? "No recent session observations in this scope. Start a conversation below." : "Outcomes are unavailable in this observation.")}
    <p className="home-overview__note"><strong>Committed effects:</strong> Protected commit receipts are not supplied by this session list. A completed session is not proof of a committed effect. Open a conversation to inspect inline Activity and Run Details.</p>
    <p className="home-overview__note">Times describe when Cave received these observations, not when an effect committed. Session observations do not grant permission to act.</p>
  </section>;
}
