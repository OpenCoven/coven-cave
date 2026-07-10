"use client";

import { useEffect, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { useProjects } from "@/lib/use-projects";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { PropertyPill } from "@/components/ui/property-pill";
import { StandardSelect } from "@/components/ui/select";
import {
  STATUSES,
  PRIORITIES,
  type CardPriority,
  type CardStatus,
} from "@/lib/cave-board-types";
import { useIsCoarsePointer } from "@/lib/use-viewport";

export type NewCardDraft = {
  title: string;
  notes: string;
  status: CardStatus;
  priority: CardPriority;
  familiarId: string | null;
  sessionId: string | null;
  projectId: string | null;
  cwd: string | null;
  links: string[];
  labels: string[];
  startDate: string | null;
  endDate: string | null;
  template: null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  familiars: Familiar[];
  sessions: SessionRow[];
  defaultStatus?: CardStatus;
  defaultFamiliarId?: string | null;
  defaultTitle?: string;
  defaultLinks?: string[];
  defaultNotes?: string;
  defaultLabels?: string[];
  onCreate: (draft: NewCardDraft) => Promise<void> | void;
};

export function NewCardModal({
  open,
  onClose,
  familiars,
  sessions,
  defaultStatus = "inbox",
  defaultFamiliarId = null,
  defaultTitle,
  defaultLinks,
  defaultNotes,
  defaultLabels,
  onCreate,
}: Props) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<CardStatus>(defaultStatus);
  const [priority, setPriority] = useState<CardPriority>("medium");
  const [familiarId, setFamiliarId] = useState<string | null>(defaultFamiliarId);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [links, setLinks] = useState("");
  const [labels, setLabels] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coarse = useIsCoarsePointer();

  // Only offer projects the assigned familiar can actually reach — the board
  // POST starts the card's chat under that familiar, which the server rejects
  // (403) for an ungranted project. Re-scopes when the Familiar picker below
  // changes; a null familiar ("Default familiar") loads the operator-wide list.
  const { projects } = useProjects({ familiarId, enabled: open });

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle ?? "");
    setNotes(defaultNotes ?? "");
    setStatus(defaultStatus);
    setPriority("medium");
    setFamiliarId(defaultFamiliarId);
    setSessionId(null);
    setProjectId(null);
    setLinks(defaultLinks ? defaultLinks.join("\n") : "");
    setLabels(defaultLabels ? defaultLabels.join(", ") : "");
    setStartDate("");
    setEndDate("");
    setError(null);
  }, [open, defaultStatus, defaultFamiliarId, defaultTitle, defaultLinks, defaultNotes, defaultLabels]);

  const eligibleSessions = familiarId
    ? sessions.filter((s) => s.familiarId === familiarId)
    : sessions;

  // The selected project drives the card's working directory — there is no
  // free-form cwd field, so drafts never carry machine-specific paths.
  const selectedProject = projects.find((p) => p.id === projectId) ?? null;

  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        title: title.trim(),
        notes: notes.trim(),
        status,
        priority,
        familiarId,
        sessionId,
        projectId,
        cwd: selectedProject?.root ?? null,
        links: parseDelimited(links),
        labels: parseDelimited(labels),
        startDate: startDate || null,
        endDate: endDate || null,
        template: null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  };

  const familiarLabel =
    familiars.find((f) => f.id === familiarId)?.display_name ?? "Default familiar";
  const sessionLabel =
    sessions.find((s) => s.id === sessionId)?.title ?? null;
  const projectLabel = selectedProject?.name ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      breadcrumb={["Tasks", "New task"]}
      footerPills={
        <>
          <PropertyPill
            icon="ph:circle"
            label={`Status: ${cap(status)}`}
            filled
            title="Status (set in fields above)"
          />
          <PropertyPill
            icon="ph:circle-fill"
            label={`Priority: ${cap(priority)}`}
            filled
            title="Priority (set in fields above)"
          />
          <PropertyPill
            icon="ph:sparkle"
            label={familiarLabel}
            filled={familiarId !== null}
          />
          {sessionLabel ? (
            <PropertyPill icon="ph:chat-circle-dots" label={sessionLabel} filled />
          ) : null}
          {projectLabel ? (
            <PropertyPill icon="ph:folder" label={projectLabel} filled />
          ) : null}
        </>
      }
      footerActions={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={create}
            disabled={!title.trim() || busy}
          >
            {busy ? "Creating…" : "Create"}
          </Button>
        </>
      }
    >
      <Field label="Title">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title"
          autoFocus={!coarse}
          className="w-full rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-border-strong"
        />
      </Field>

      <Field label="Notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes, acceptance criteria, links"
          rows={6}
          className="w-full resize-y rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-border-strong"
        />
      </Field>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <Field label="Status">
          <Select
            value={status}
            onChange={(v) => setStatus(v as CardStatus)}
            options={STATUSES.map((s) => ({ value: s, label: cap(s) }))}
          />
        </Field>
        <Field label="Priority">
          <Select
            value={priority}
            onChange={(v) => setPriority(v as CardPriority)}
            options={PRIORITIES.map((p) => ({ value: p, label: cap(p) }))}
          />
        </Field>

        <Field label="Familiar">
          <Select
            value={familiarId ?? ""}
            onChange={(v) => {
              setFamiliarId(v || null);
              setSessionId(null);
              // The project list re-scopes to the new familiar; a project the
              // previous familiar could reach may not be granted to this one.
              setProjectId(null);
            }}
            options={[
              { value: "", label: "Default familiar" },
              ...familiars.map((f) => ({
                value: f.id,
                label: `${f.display_name} · ${f.harness ?? "?"}`,
              })),
            ]}
          />
        </Field>

        <Field label="Project">
          <Select
            value={projectId ?? ""}
            onChange={(v) => setProjectId(v || null)}
            options={[
              { value: "", label: "No project" },
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </Field>
      </div>

      {/* Optional metadata lives behind a disclosure so the default modal
          stays a short title/notes/pickers form. Open it when a caller
          prefilled links or labels so they aren't hidden. */}
      <details className="mb-4" open={Boolean(defaultLinks?.length || defaultLabels?.length)}>
        <summary className="focus-ring mb-2 cursor-pointer select-none text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground">
          More options
        </summary>

        <Field label="Session (optional)">
          <Select
            value={sessionId ?? ""}
            onChange={(v) => setSessionId(v || null)}
            options={[
              { value: "", label: "No linked session" },
              ...eligibleSessions.slice(0, 30).map((s) => ({
                value: s.id,
                label: `${s.title || "(untitled)"} · ${s.harness}`,
              })),
            ]}
          />
        </Field>

        <div className="mb-4 grid grid-cols-2 gap-4">
          <Field label="Start date">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-border-strong"
            />
          </Field>
          <Field label="End date">
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-border-strong"
            />
          </Field>
        </div>

        <Field label="Links">
          <textarea
            value={links}
            onChange={(e) => setLinks(e.target.value)}
            placeholder="One link per line, e.g. https://github.com/owner/repo/pull/123"
            rows={3}
            className="w-full resize-y rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-border-strong"
          />
        </Field>

        <Field label="Labels">
          <input
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            placeholder="ui, docs"
            className="w-full rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-border-strong"
          />
        </Field>
      </details>

      {error ? (
        <div className="mb-3 rounded-[var(--radius-control)] border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
          {error}
        </div>
      ) : null}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <div className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <StandardSelect
      label="Choose value"
      value={value}
      onChange={onChange}
      options={options}
      className="w-full border-border bg-background px-3 py-2 text-sm text-foreground focus:border-border-strong"
    />
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseDelimited(value: string): string[] {
  return [...new Set(value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean))];
}
