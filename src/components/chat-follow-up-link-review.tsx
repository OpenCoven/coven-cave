"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { Modal } from "@/components/ui/modal";
import {
  linksFromFollowUpSource,
  saveFollowUpLinks,
  type FollowUpLinkDestination,
} from "@/lib/chat-follow-up-links";

export type FollowUpLinkReviewProps = {
  open: boolean;
  reviewIdentity: object;
  links: string[];
  task: { id: string; title: string } | null;
  onClose: () => void;
};

const NO_LINKS_MESSAGE = "No links available to save";

export function FollowUpLinkReview({
  open,
  reviewIdentity,
  links,
  task,
  onClose,
}: FollowUpLinkReviewProps) {
  const { announce } = useAnnouncer();
  const descriptionId = useId();
  const linkSource = links.join("\n");
  const validLinks = useMemo(() => linksFromFollowUpSource(linkSource), [linkSource]);
  const [selected, setSelected] = useState<string[]>([]);
  const [destination, setDestination] = useState<"resources" | "task">("resources");
  const [saving, setSaving] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const saveGenerationRef = useRef(0);

  useLayoutEffect(() => {
    const generation = ++saveGenerationRef.current;
    return () => {
      if (saveGenerationRef.current === generation) saveGenerationRef.current += 1;
    };
  }, [open, reviewIdentity, task?.id, task?.title, validLinks]);

  useEffect(() => {
    setSaving(false);
    if (open) {
      setSelected(validLinks);
      setDestination("resources");
      setSelectionError(validLinks.length === 0 ? NO_LINKS_MESSAGE : null);
      setServerError(null);
    }
  }, [open, reviewIdentity, task?.id, task?.title, validLinks]);

  useEffect(() => {
    if (!task && destination === "task") setDestination("resources");
  }, [destination, task]);

  const close = () => {
    if (!saving) onClose();
  };

  const toggleLink = (url: string) => {
    const next = new Set(selected);
    if (next.has(url)) next.delete(url);
    else next.add(url);
    const nextSelected = validLinks.filter((candidate) => next.has(candidate));
    setSelected(nextSelected);
    setSelectionError(nextSelected.length === 0 ? NO_LINKS_MESSAGE : null);
    setServerError(null);
  };

  const save = async () => {
    if (saving || selected.length === 0) return;

    let request: FollowUpLinkDestination;
    if (destination === "task") {
      if (!task) return;
      request = { destination: "task", taskId: task.id, urls: selected };
    } else {
      request = { destination: "resources", urls: selected };
    }

    setSaving(true);
    setServerError(null);
    const generation = saveGenerationRef.current;
    const result = await saveFollowUpLinks(request);
    if (saveGenerationRef.current !== generation) return;
    setSaving(false);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    announce(result.message);
    onClose();
  };

  const primaryLabel = destination === "resources" ? "Save links" : "Attach links";
  const error = selectionError ?? serverError;

  return (
    <Modal
      open={open}
      onClose={close}
      breadcrumb={["Chat", "Save links"]}
      ariaDescribedBy={descriptionId}
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
            disabled={saving || selected.length === 0}
          >
            {primaryLabel}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p
          id={descriptionId}
          className="m-0 text-[length:var(--text-base)] text-[var(--text-secondary)]"
        >
          Choose which links to keep and where to keep them.
        </p>

        {validLinks.length > 0 ? (
          <fieldset className="m-0 grid gap-2 border-0 p-0" disabled={saving}>
            <legend className="mb-2 text-[length:var(--text-sm)] font-semibold text-[var(--text-primary)]">
              Links
            </legend>
            {validLinks.map((url) => (
              <label
                key={url}
                className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-[length:var(--text-sm)] text-[var(--text-primary)]"
              >
                <input
                  type="checkbox"
                  className="focus-ring mt-1 size-4 shrink-0 accent-[var(--accent-presence)]"
                  checked={selected.includes(url)}
                  onChange={() => toggleLink(url)}
                />
                <span className="min-w-0 break-all">{url}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        <fieldset className="m-0 grid gap-2 border-0 p-0" disabled={saving}>
          <legend className="mb-2 text-[length:var(--text-sm)] font-semibold text-[var(--text-primary)]">
            Destination
          </legend>
          <label className="flex cursor-pointer items-center gap-2 text-[length:var(--text-sm)] text-[var(--text-primary)]">
            <input
              type="radio"
              name="follow-up-link-destination"
              className="focus-ring size-4 shrink-0 accent-[var(--accent-presence)]"
              value="resources"
              checked={destination === "resources"}
              onChange={() => {
                setDestination("resources");
                setServerError(null);
              }}
            />
            <span>Research Resources</span>
          </label>
          {task ? (
            <label className="flex cursor-pointer items-center gap-2 text-[length:var(--text-sm)] text-[var(--text-primary)]">
              <input
                type="radio"
                name="follow-up-link-destination"
                className="focus-ring size-4 shrink-0 accent-[var(--accent-presence)]"
                value="task"
                checked={destination === "task"}
                onChange={() => {
                  setDestination("task");
                  setServerError(null);
                }}
              />
              <span>
                Current task: <span className="font-semibold">{task.title}</span>
              </span>
            </label>
          ) : null}
        </fieldset>

        {error ? (
          <p
            className="m-0 text-[length:var(--text-sm)] text-[var(--color-danger)]"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
