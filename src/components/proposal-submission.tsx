"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useAnnouncer } from "@/components/ui/live-region";
import { parseProposalSubmission, type SubmissionOutcome } from "@/lib/proposal-submission";
import { INITIAL_SUBMISSION, ProposalSubmissionController, parseSubmissionResponse } from "@/lib/proposal-submission-controller";
import "@/styles/proposal-submission.css";

// Shared across route remounts. Storage is accessed only after client mounting.
const controller = new ProposalSubmissionController({
  getItem: key => sessionStorage.getItem(key),
  setItem: (key, value) => sessionStorage.setItem(key, value),
  removeItem: key => sessionStorage.removeItem(key),
});
const serverSnapshot = () => INITIAL_SUBMISSION;
function outcomeText(outcome: SubmissionOutcome): string {
  switch (outcome.kind) {
    case "applied": return "The daemon confirmed the edit was applied.";
    case "staged": return "The daemon staged the edit for review. Refresh the proposal queue to inspect it.";
    case "held": return "The daemon held the edit. Inspect the familiar’s audit log before making another change.";
    case "refused": return "The daemon refused this edit. Check the familiar, its Ward configuration, and edit limits before preparing another edit.";
    case "unavailable": return "Submission is unavailable. Check the daemon connection, fixture mode and browser storage before trying again.";
    case "unknown": return "The result is unknown. Do not repeat this edit until you have checked the file and the daemon’s audit log.";
  }
}

export function ProposalSubmission({ available, onRefresh }: { available: () => boolean; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [familiarId, setFamiliarId] = useState("");
  const [target, setTarget] = useState("");
  const [contents, setContents] = useState("");
  const [error, setError] = useState<string | null>(null);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, serverSnapshot);
  const { announce } = useAnnouncer();
  const id = useId();
  useEffect(() => controller.hydrate(), []);
  const busy = snapshot.phase === "pending";
  const canSend = available() && snapshot.phase === "idle";
  const close = () => { if (!busy) setOpen(false); };
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!canSend || !available()) return;
    const input = parseProposalSubmission({ familiarId, target, contents });
    if (!input) {
      setError("Use a familiar ID, a relative file path without traversal, and at most 64 KiB of UTF-8 file contents.");
      return;
    }
    setError(null);
    announce("Sending edit to the daemon.");
    const sent = await controller.submit(input, async body => {
      const response = await fetch("/api/proposals/submit", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      return parseSubmissionResponse(response.status, await response.json());
    });
    const outcome = controller.getSnapshot().outcome;
    if (outcome) announce(outcomeText(outcome));
    if (sent && outcome?.kind !== "unknown") onRefresh();
  }
  return <>
    <Button size="sm" onClick={() => setOpen(true)}>Send an edit</Button>
    <Modal open={open} onClose={close} breadcrumb={["Proposals", "Send an edit"]}
      dismissOnBackdrop={!busy} dismissOnEscape={!busy} ariaDescribedBy={`${id}-help`}>
      <form className="proposal-submission" onSubmit={event => void send(event)}>
        <p id={`${id}-help`}>Send the complete replacement for one file. The daemon may apply it immediately or hold it for review. Protected surfaces remain subject to its authority checks.</p>
        <label htmlFor={`${id}-familiar`}>Familiar ID</label>
        <input id={`${id}-familiar`} className="focus-ring" required value={familiarId} maxLength={128}
          aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
          disabled={!canSend} onChange={event => setFamiliarId(event.target.value)} placeholder="e.g., sage" />
        <label htmlFor={`${id}-target`}>Relative file path</label>
        <input id={`${id}-target`} className="focus-ring" required value={target} maxLength={1024}
          aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
          disabled={!canSend} onChange={event => setTarget(event.target.value)} placeholder="e.g., notes/today.md" />
        <label htmlFor={`${id}-contents`}>Full replacement contents</label>
        <textarea id={`${id}-contents`} className="focus-ring" value={contents} maxLength={65536} rows={10}
          disabled={!canSend} onChange={event => setContents(event.target.value)} aria-invalid={!!error} aria-describedby={`${id}-contents-help${error ? ` ${id}-error` : ""}`} />
        <p id={`${id}-contents-help`}>Up to 64 KiB of UTF-8 text. Empty contents replace the file with an empty file.</p>
        {!available() ? <><p role="status">Refresh the proposals queue to establish a current daemon connection before sending an edit.</p><Button onClick={onRefresh}>Refresh proposals</Button></> : null}
        {error ? <p id={`${id}-error`} role="alert">{error}</p> : null}
        {busy ? <p role="status">Waiting for the daemon’s response…</p> : null}
        {snapshot.outcome ? <p role="status">{outcomeText(snapshot.outcome)}</p> : null}
        <div className="proposal-submission__actions">
          <Button onClick={close} disabled={busy}>Close</Button>
          {snapshot.phase === "settled" ? <>
            <Button onClick={onRefresh}>Refresh proposals</Button>
            <Button onClick={() => {
              if (controller.reset()) { setContents(""); setError(null); announce("Ready for another edit."); }
              else announce("Browser storage is unavailable. Submission remains blocked.");
            }}>{snapshot.outcome?.kind === "unknown" ? "I checked the file and audit log" : "Prepare another edit"}</Button>
          </> : <Button type="submit" variant="primary" disabled={!canSend} loading={busy}>Send edit</Button>}
        </div>
      </form>
    </Modal>
  </>;
}
