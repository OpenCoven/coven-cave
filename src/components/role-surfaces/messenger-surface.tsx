"use client";

/**
 * Messenger Surface — a communications operations center.
 *
 * Outbound and inbound communication across channels. Left rail: real inbox
 * items (Cave `/api/inbox`), pending drafts, scheduled items. Center: a
 * channel-aware composer and thread workspace. Right sidebar: tone, audience,
 * approval state, delivery status. Bottom drawer: queued deliveries and
 * recent sends.
 *
 * Nothing here sends externally — the Cave has no external delivery approval
 * flow yet, so every draft ends at "approved, awaiting delivery integration"
 * and the delivery panel says so honestly.
 */

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { RoleSurfaceContext } from "@/lib/role-surfaces";
import { useRoleSurfaceState } from "@/lib/role-surface-state";
import { RailSection, SurfaceCanvas, SurfaceEmpty, SurfaceRail, SurfaceRoom } from "./surface-room";
import { MESSENGER_SURFACE_ID } from "./ids";

export type MessageChannel = "email" | "discord" | "slack" | "sms" | "teams" | "social";

export type DraftStatus = "draft" | "needs-approval" | "approved";

type Draft = {
  id: string;
  channel: MessageChannel;
  to: string;
  subject: string;
  body: string;
  tone: string;
  status: DraftStatus;
  createdAt: string;
};

export type MessengerState = {
  drafts: Draft[];
  selectedDraftId: string | null;
  drawerOpen: boolean;
};

export const MESSENGER_INITIAL_STATE: MessengerState = {
  drafts: [],
  selectedDraftId: null,
  drawerOpen: false,
};

/** Channel-aware drafting conventions shown beside the composer. */
export const CHANNEL_CONVENTIONS: Record<MessageChannel, { label: string; hint: string; limit?: number }> = {
  email: { label: "Email", hint: "Subject line required; greeting and sign-off expected." },
  discord: { label: "Discord", hint: "Markdown works; keep it conversational, mention with @." },
  slack: { label: "Slack", hint: "Short paragraphs; threads over walls of text; :emoji: ok." },
  sms: { label: "SMS", hint: "Plain text only.", limit: 160 },
  teams: { label: "Teams", hint: "Professional register; @mention for attention." },
  social: { label: "Social post", hint: "Front-load the hook; hashtags sparingly.", limit: 280 },
};

const CHANNELS = Object.keys(CHANNEL_CONVENTIONS) as MessageChannel[];
const TONES = ["neutral", "warm", "formal", "urgent", "playful"];

const uid = () => Math.random().toString(36).slice(2, 10);

type InboxItemWire = {
  id: string;
  title: string;
  status: string;
  fireAt?: string | null;
  familiarId?: string | null;
  createdAt: string;
};

export function MessengerSurface({ context }: { context: RoleSurfaceContext }) {
  const familiarId = context.activeFamiliar.id;
  const [state, patch] = useRoleSurfaceState<MessengerState>(
    familiarId,
    MESSENGER_SURFACE_ID,
    MESSENGER_INITIAL_STATE,
  );

  // Real inbound items from the Cave inbox, scoped to this familiar.
  const [inbox, setInbox] = useState<InboxItemWire[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/inbox", { cache: "no-store" });
        const json = res.ok ? ((await res.json()) as { items?: InboxItemWire[] }) : null;
        if (!cancelled) {
          setInbox((json?.items ?? []).filter((item) => !item.familiarId || item.familiarId === familiarId));
        }
      } catch {
        if (!cancelled) setInbox([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [familiarId]);

  const selected = state.drafts.find((d) => d.id === state.selectedDraftId) ?? null;

  const newDraft = (channel: MessageChannel = "email") => {
    const draft: Draft = {
      id: uid(),
      channel,
      to: "",
      subject: "",
      body: "",
      tone: "neutral",
      status: "draft",
      createdAt: new Date().toISOString(),
    };
    patch({ drafts: [draft, ...state.drafts], selectedDraftId: draft.id });
  };

  const updateSelected = (update: Partial<Draft>) => {
    if (!selected) return;
    patch({
      drafts: state.drafts.map((d) => (d.id === selected.id ? { ...d, ...update } : d)),
    });
  };

  const pending = state.drafts.filter((d) => d.status === "needs-approval");
  const approved = state.drafts.filter((d) => d.status === "approved");
  const scheduled = useMemo(
    () => (inbox ?? []).filter((item) => item.fireAt && new Date(item.fireAt) > new Date()),
    [inbox],
  );

  const convention = selected ? CHANNEL_CONVENTIONS[selected.channel] : null;
  const overLimit =
    selected && convention?.limit != null && selected.body.length > convention.limit;

  return (
    <SurfaceRoom
      accentHue={210}
      drawerTitle="Delivery queue"
      drawerOpen={state.drawerOpen}
      onToggleDrawer={() => patch({ drawerOpen: !state.drawerOpen })}
      drawer={
        <div className="role-surface-drawer-grid">
          <RailSection title="Queued deliveries" iconName="ph:paper-plane-tilt">
            {approved.length === 0 ? (
              <SurfaceEmpty
                title="Nothing queued."
                hint="Approved drafts wait here — no delivery integration is connected, so nothing sends."
              />
            ) : (
              <ul className="role-surface-list">
                {approved.map((draft) => (
                  <li key={draft.id} className="role-surface-list-row">
                    <span>
                      [{CHANNEL_CONVENTIONS[draft.channel].label}] {draft.subject || draft.body.slice(0, 48) || "(empty)"}
                    </span>
                    <span className="role-surface-tag">awaiting integration</span>
                  </li>
                ))}
              </ul>
            )}
          </RailSection>
          <RailSection title="Scheduled" iconName="ph:clock">
            {scheduled.length === 0 ? (
              <SurfaceEmpty title="No scheduled messages." />
            ) : (
              <ul className="role-surface-list">
                {scheduled.map((item) => (
                  <li key={item.id} className="role-surface-list-row">
                    <span>{item.title}</span>
                    <span className="role-surface-tag">{new Date(item.fireAt!).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </RailSection>
          <RailSection title="Recent sends" iconName="ph:check">
            <SurfaceEmpty title="No sends recorded." hint="External sends require an approval flow the Cave doesn't have yet." />
          </RailSection>
        </div>
      }
    >
      <SurfaceRail side="left" label="Traffic">
        <RailSection
          title="Drafts"
          iconName="ph:pencil-simple"
          actions={
            <button type="button" className="role-surface-chip focus-ring" onClick={() => newDraft()}>
              <Icon name="ph:plus" width={12} height={12} aria-hidden />
              New
            </button>
          }
        >
          {state.drafts.length === 0 ? (
            <SurfaceEmpty title="No drafts." hint="Start one — every channel has its own conventions." />
          ) : (
            <ul className="role-surface-list">
              {state.drafts.map((draft) => (
                <li key={draft.id}>
                  <button
                    type="button"
                    className={`role-surface-row-btn focus-ring-inset${draft.id === state.selectedDraftId ? " role-surface-row-btn--active" : ""}`}
                    onClick={() => patch({ selectedDraftId: draft.id })}
                  >
                    <span className="role-surface-tag">{CHANNEL_CONVENTIONS[draft.channel].label}</span>
                    {draft.subject || draft.body.slice(0, 40) || "(empty draft)"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
        <RailSection title="Inbox" iconName="ph:tray">
          {inbox == null ? (
            <SurfaceEmpty title="Loading inbox…" />
          ) : inbox.length === 0 ? (
            <SurfaceEmpty title="Inbox is clear." />
          ) : (
            <ul className="role-surface-list">
              {inbox.slice(0, 10).map((item) => (
                <li key={item.id} className="role-surface-list-row">
                  <span>{item.title}</span>
                  <span className="role-surface-tag">{item.status}</span>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
        <RailSection title="Awaiting approval" iconName="ph:warning">
          {pending.length === 0 ? (
            <SurfaceEmpty title="Nothing awaiting approval." />
          ) : (
            <ul className="role-surface-list">
              {pending.map((draft) => (
                <li key={draft.id}>
                  <button
                    type="button"
                    className="role-surface-row-btn focus-ring-inset"
                    onClick={() => patch({ selectedDraftId: draft.id })}
                  >
                    {draft.subject || draft.body.slice(0, 40) || "(empty draft)"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
      </SurfaceRail>

      <SurfaceCanvas label="Composer">
        {!selected ? (
          <SurfaceEmpty
            iconName="ph:paper-plane-tilt"
            title="No draft selected."
            hint="Pick a draft from the rail or start a new one."
          />
        ) : (
          <div className="role-surface-canvas-stack">
            <div className="role-surface-composer-row">
              <label className="role-surface-field">
                <span className="role-surface-field-label">Channel</span>
                <select
                  value={selected.channel}
                  onChange={(e) => updateSelected({ channel: e.target.value as MessageChannel })}
                >
                  {CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {CHANNEL_CONVENTIONS[channel].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="role-surface-field role-surface-field--grow">
                <span className="role-surface-field-label">To</span>
                <input
                  value={selected.to}
                  onChange={(e) => updateSelected({ to: e.target.value })}
                  placeholder="Recipient / channel target…"
                />
              </label>
            </div>
            {selected.channel === "email" && (
              <label className="role-surface-field">
                <span className="role-surface-field-label">Subject</span>
                <input
                  value={selected.subject}
                  onChange={(e) => updateSelected({ subject: e.target.value })}
                  placeholder="Subject…"
                />
              </label>
            )}
            {convention && (
              <p className="role-surface-hint">
                <Icon name="ph:lightbulb" width={13} height={13} aria-hidden />
                {convention.hint}
                {convention.limit != null && (
                  <span className={overLimit ? "role-surface-metric-warn" : undefined}>
                    {" "}
                    {selected.body.length}/{convention.limit}
                  </span>
                )}
              </p>
            )}
            <label className="role-surface-field">
              <span className="role-surface-field-label">Message</span>
              <textarea
                className="role-surface-notes"
                value={selected.body}
                onChange={(e) => updateSelected({ body: e.target.value })}
                placeholder="Compose…"
              />
            </label>
          </div>
        )}
      </SurfaceCanvas>

      <SurfaceRail side="right" label="Dispatch">
        {!selected ? (
          <RailSection title="Dispatch" iconName="ph:paper-plane-tilt">
            <SurfaceEmpty title="Select a draft to manage dispatch." />
          </RailSection>
        ) : (
          <>
            <RailSection title="Tone & audience" iconName="ph:chats-circle">
              <label className="role-surface-field">
                <span className="role-surface-field-label">Tone</span>
                <select value={selected.tone} onChange={(e) => updateSelected({ tone: e.target.value })}>
                  {TONES.map((tone) => (
                    <option key={tone} value={tone}>
                      {tone}
                    </option>
                  ))}
                </select>
              </label>
              <p className="role-surface-hint">
                Audience: {selected.to || "unspecified"} via {CHANNEL_CONVENTIONS[selected.channel].label}
              </p>
            </RailSection>
            <RailSection title="Approval" iconName="ph:check">
              <p className="role-surface-hint">
                External sends always require approval. Status:{" "}
                <span className="role-surface-tag">{selected.status}</span>
              </p>
              <div className="role-surface-btn-row">
                {selected.status === "draft" && (
                  <button
                    type="button"
                    className="role-surface-chip focus-ring"
                    onClick={() => updateSelected({ status: "needs-approval" })}
                  >
                    Request approval
                  </button>
                )}
                {selected.status === "needs-approval" && (
                  <>
                    <button
                      type="button"
                      className="role-surface-chip role-surface-chip--accent focus-ring"
                      onClick={() => updateSelected({ status: "approved" })}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="role-surface-chip focus-ring"
                      onClick={() => updateSelected({ status: "draft" })}
                    >
                      Back to draft
                    </button>
                  </>
                )}
                {selected.status === "approved" && (
                  <button
                    type="button"
                    className="role-surface-chip focus-ring"
                    onClick={() => updateSelected({ status: "draft" })}
                  >
                    Revoke approval
                  </button>
                )}
                <button
                  type="button"
                  className="role-surface-icon-btn focus-ring"
                  aria-label="Delete draft"
                  onClick={() =>
                    patch({
                      drafts: state.drafts.filter((d) => d.id !== selected.id),
                      selectedDraftId: null,
                    })
                  }
                >
                  <Icon name="ph:trash" width={13} height={13} aria-hidden />
                </button>
              </div>
            </RailSection>
            <RailSection title="Delivery status" iconName="ph:paper-plane-tilt">
              <SurfaceEmpty
                title="No delivery integrations connected."
                hint="Approved drafts stay queued locally; nothing leaves the Cave."
              />
            </RailSection>
          </>
        )}
      </SurfaceRail>
    </SurfaceRoom>
  );
}
