"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  REBASE_FIELD_LABEL,
  rebaseValuePreview,
  rebasedPatch,
  unresolvedConflicts,
  type RebaseChoice,
  type RebaseField,
  type RebaseFieldReview,
  type RevisionRebase,
} from "@/lib/automations/revision-rebase";
import type { CodexAutomationPatch } from "@/lib/codex-automations-types";

const STATUS_LABEL = { ACTIVE: "active", PAUSED: "paused", DISABLED: "disabled" } as const;

function Quote({ field, value }: { field: RebaseField; value: string }) {
  return <q className="break-words text-[var(--text-primary)]">{rebaseValuePreview(field, value)}</q>;
}

function FullText({ entry }: { entry: RebaseFieldReview }) {
  // Long instructions are clipped above; both full texts stay one click away.
  if (entry.field !== "prompt") return null;
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-[var(--text-muted)]">Show both full texts</summary>
      <p className="mt-1 font-medium">Yours</p>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-control)] bg-[var(--bg-base)] p-2">{entry.mine}</pre>
      <p className="mt-1 font-medium">Coven&apos;s</p>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-control)] bg-[var(--bg-base)] p-2">{entry.theirs}</pre>
    </details>
  );
}

/**
 * Shown when Coven refused a save because the definition moved on. It says
 * what changed on each side, makes the person choose wherever both sides
 * changed the same field, and only then offers to re-apply their edits at the
 * newer revision. Nothing is written until they choose, and Coven checks that
 * revision again.
 */
export function RevisionConflictReview({
  rebase,
  busy,
  onSaveMine,
  onUseTheirs,
  onKeepEditing,
}: {
  rebase: RevisionRebase;
  busy: boolean;
  /** Re-apply the person's kept edits at `rebase.revision`. */
  onSaveMine: (patch: CodexAutomationPatch, revision: number) => void;
  /** Drop the edit and show Coven's newer definition. */
  onUseTheirs: () => void;
  /** Close the review and keep the form as it is; nothing is saved. */
  onKeepEditing: () => void;
}) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [choices, setChoices] = useState<Partial<Record<RebaseField, RebaseChoice>>>({});
  // Keyboard and screen-reader users land on the review, not wherever the Save button was.
  useEffect(() => { heading.current?.focus(); }, [rebase.revision]);

  const changed = rebase.fields.filter((entry) => entry.kind !== "unchanged");
  const unresolved = unresolvedConflicts(rebase, choices);
  const patch = rebasedPatch(rebase, choices);
  const saveReason = unresolved.length > 0
    ? `Choose a value for ${unresolved.map((field) => REBASE_FIELD_LABEL[field]).join(", ")} first.`
    : patch === null ? "None of your edits remain to save. Use Coven's version instead." : null;

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3 rounded-[var(--radius-control)] border p-3 text-[length:var(--text-xs)] text-[var(--text-secondary)] [border-color:var(--color-warning)]!"
    >
      <h3 id={headingId} ref={heading} tabIndex={-1} className="text-[length:var(--text-sm)] font-semibold text-[var(--text-primary)] focus:outline-none">
        Coven has a newer revision
      </h3>
      <p role="alert">
        Your save was not applied. Coven now holds revision {rebase.revision}, which changed after you opened this cron.
        Review what changed before saving again.
      </p>
      {rebase.statusChanged ? (
        <p role="note">
          Coven&apos;s revision is {STATUS_LABEL[rebase.statusChanged.to]}; it was {STATUS_LABEL[rebase.statusChanged.from]}. Saving never changes this.
        </p>
      ) : null}
      {changed.length > 0 ? (
        <ul className="space-y-2" aria-label="Changed fields">
          {changed.map((entry) => {
            const label = REBASE_FIELD_LABEL[entry.field];
            if (entry.kind === "conflict") {
              const name = `${headingId}-${entry.field}`;
              return (
                <li key={entry.field}>
                  <fieldset className="space-y-1">
                    <legend className="font-medium text-[var(--text-primary)]">{label}: changed by you and in Coven</legend>
                    {(["mine", "theirs"] as const).map((choice) => (
                      <label key={choice} className="flex items-start gap-2">
                        <input
                          type="radio"
                          name={name}
                          value={choice}
                          checked={choices[entry.field] === choice}
                          onChange={() => setChoices((previous) => ({ ...previous, [entry.field]: choice }))}
                        />
                        <span className="min-w-0">
                          {choice === "mine" ? "Keep yours: " : "Use Coven's: "}
                          <Quote field={entry.field} value={choice === "mine" ? entry.mine : entry.theirs} />
                        </span>
                      </label>
                    ))}
                    <FullText entry={entry} />
                  </fieldset>
                </li>
              );
            }
            return (
              <li key={entry.field} className="min-w-0">
                <span className="font-medium text-[var(--text-primary)]">{label}: </span>
                {entry.kind === "mine" ? <>your change, <Quote field={entry.field} value={entry.mine} />, will be re-applied.</>
                  : entry.kind === "theirs" ? <>changed in Coven to <Quote field={entry.field} value={entry.theirs} />. You didn&apos;t change it, so Coven&apos;s value stays.</>
                    : <>you and Coven made the same change.</>}
                {entry.kind === "theirs" ? <FullText entry={entry} /> : null}
              </li>
            );
          })}
        </ul>
      ) : <p>No field differs from what you started with. Coven&apos;s revision moved without changing anything you edit here.</p>}
      {saveReason ? <p role="note">{saveReason}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="xs"
          variant="primary"
          disabled={busy || patch === null}
          onClick={() => { if (patch) onSaveMine(patch, rebase.revision); }}
        >
          Save my changes on revision {rebase.revision}
        </Button>
        <Button size="xs" disabled={busy} onClick={onUseTheirs}>Use Coven&apos;s version</Button>
        <Button size="xs" variant="ghost" disabled={busy} onClick={onKeepEditing}>Keep editing</Button>
      </div>
    </section>
  );
}
