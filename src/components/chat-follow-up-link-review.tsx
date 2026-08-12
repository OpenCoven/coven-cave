"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { Modal } from "@/components/ui/modal";
import {
  linksFromFollowUpSource,
  saveFollowUpLinks,
} from "@/lib/chat-follow-up-links";

type Destination = "resources" | "task";

export type FollowUpLinkReviewProps = {
  open: boolean;
  links: string[];
  task?: { id: string; title: string } | null;
  onClose: () => void;
};

export function FollowUpLinkReview({
  open,
  links,
  task = null,
  onClose,
}: FollowUpLinkReviewProps) {
  const { announce } = useAnnouncer();
  const availableLinks = useMemo(() => linksFromFollowUpSource(links.join("\n")), [links]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(availableLinks));
  const [destination, setDestination] = useState<Destination>("resources");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    setSelected(new Set(availableLinks));
    setDestination("resources");
    setSaving(false);
    setError(null);
  }, [availableLinks, open]);

  useEffect(() => {
    if (destination === "task" && !task) {
      setDestination("resources");
    }
  }, [destination, task]);

  const close = () => {
    if (!saving) onClose();
  };

  const selectedUrls = availableLinks.filter((link) => selected.has(link));
  const selectedCount = selectedUrls.length;
  const actionLabel = destination === "resources" ? "Save links" : "Attach links";

  const toggleLink = (value: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(value);
      else next.delete(value);
      return next;
    });
  };

  const save = async () => {
    if (saving) return;
    const taskId = destination === "task" ? task?.id ?? null : null;
    if (destination === "task" && !taskId) {
      const message = "Current task is no longer available.";
      setError(message);
      announce(message, "assertive");
      return;
    }

    setSaving(true);
    setError(null);
    const result = destination === "resources"
      ? await saveFollowUpLinks({ destination, urls: selectedUrls })
      : taskId
        ? await saveFollowUpLinks({ destination, taskId, urls: selectedUrls })
        : { ok: false as const, error: "Current task is no longer available." };
    setSaving(false);

    if (!result.ok) {
      const message = result.error;
      setError(message);
      announce(message, "assertive");
      return;
    }

    announce(result.message);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      breadcrumb={["Chat", "Save links"]}
      dismissOnEscape={!saving}
      dismissOnBackdrop={!saving}
      footerActions={
        <>
          <Button variant="ghost" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void save()}
            loading={saving}
            disabled={saving || selectedUrls.length === 0}
          >
            {actionLabel}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="m-0 text-[length:var(--text-base)] text-[var(--text-secondary)]">
          Choose which links to keep, then decide whether to save them to Research Resources or attach them to the current task.
        </p>

        <fieldset className="grid gap-2 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3">
          <legend className="px-1 text-[length:var(--text-sm)] font-medium text-[var(--text-primary)]">
            Destination
          </legend>
          <label className="flex items-start gap-2 text-[length:var(--text-sm)] text-[var(--text-primary)]">
            <input
              className="focus-ring mt-0.5 shrink-0"
              type="radio"
              name="follow-up-link-destination"
              checked={destination === "resources"}
              onChange={() => setDestination("resources")}
              disabled={saving}
            />
            <span className="grid gap-0.5">
              <span className="font-medium">Research Resources</span>
              <span className="text-[var(--text-secondary)]">Save these links for future research work.</span>
            </span>
          </label>
          {task ? (
            <label className="flex items-start gap-2 text-[length:var(--text-sm)] text-[var(--text-primary)]">
              <input
                className="focus-ring mt-0.5 shrink-0"
                type="radio"
                name="follow-up-link-destination"
                checked={destination === "task"}
                onChange={() => setDestination("task")}
                disabled={saving}
              />
              <span className="grid gap-0.5">
                <span className="font-medium">Current task</span>
                <span className="text-[var(--text-secondary)]">{task.title}</span>
              </span>
            </label>
          ) : null}
        </fieldset>

        <fieldset className="grid gap-2 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3">
          <legend className="px-1 text-[length:var(--text-sm)] font-medium text-[var(--text-primary)]">
            Links
          </legend>
          <p className="m-0 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
            {selectedCount} of {availableLinks.length} selected
          </p>
          <div className="grid gap-2">
            {availableLinks.map((link) => (
              <label
                key={link}
                className="flex items-start gap-2 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--text-primary)]"
              >
                <input
                  className="focus-ring mt-0.5 shrink-0"
                  type="checkbox"
                  checked={selected.has(link)}
                  onChange={(event) => toggleLink(link, event.target.checked)}
                  disabled={saving}
                />
                <span className="min-w-0 break-all">{link}</span>
              </label>
            ))}
            {availableLinks.length === 0 ? (
              <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-secondary)]">
                No valid http(s) links are available from this follow-up.
              </p>
            ) : null}
          </div>
        </fieldset>

        {error ? (
          <p
            role="alert"
            className="m-0 rounded-[var(--radius-control)] border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--danger-text)]"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
