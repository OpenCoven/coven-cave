"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { formatApproveAnswers, type ApproveRequestDescriptor } from "@/lib/approve-blocks";
import "@/styles/chat-approve-card.css";

export type ApproveSubmissionResult = { ok: true } | { ok: false; error: string };

export type ChatApproveCardProps = {
  request: ApproveRequestDescriptor;
  disabledReason?: string;
  onSubmit: (result: { answers: Record<string, string>; text: string }) => Promise<ApproveSubmissionResult>;
};

/** Collects answers only; ChatView owns sending and persistence acknowledgement. */
export function ChatApproveCard({ request, disabledReason, onSubmit }: ChatApproveCardProps) {
  const id = useId();
  const { announce } = useAnnouncer();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<"asking" | "sending" | "sent" | "skipped">("asking");
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const answeredCount = request.questions.filter((question) => answers[question.id]?.trim()).length;
  const disabled = Boolean(disabledReason) || phase === "sending";

  async function submit() {
    if (submitting.current || disabled) return;
    const text = formatApproveAnswers(request, answers);
    if (!text) {
      setError("Choose an option or enter an answer before sending.");
      return;
    }
    submitting.current = true;
    setPhase("sending");
    setError(null);
    announce("Sending answers.");
    try {
      const result = await onSubmit({ answers, text });
      if (!result.ok) {
        setPhase("asking");
        setError(result.error);
        announce(result.error, "assertive");
        return;
      }
      const returnFocus = formRef.current?.contains(document.activeElement);
      setPhase("sent");
      announce("Answers sent.");
      if (returnFocus) requestAnimationFrame(() => summaryRef.current?.focus());
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Answers could not be sent. Try again.";
      setPhase("asking");
      setError(message);
      announce(message, "assertive");
    } finally {
      submitting.current = false;
    }
  }

  if (phase === "sent" || phase === "skipped") {
    return (
      <div className="cave-approve focus-ring" data-approve-phase={phase} tabIndex={-1} ref={summaryRef}>
        <p className="cave-approve__title">{phase === "sent" ? "Answers sent" : "Questions skipped"}</p>
        {phase === "sent" ? <p className="cave-approve__summary">{formatApproveAnswers(request, answers)}</p> : null}
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      className="cave-approve"
      data-approve-phase={phase}
      aria-label="Questions from familiar"
      aria-busy={phase === "sending"}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="cave-approve__title">Questions</p>
      <p className="cave-approve__help" id={`${id}-help`}>
        Send answers posts your choices as the next message in this chat.
      </p>
      {request.questions.map((question, index) => (
        <fieldset key={question.id} disabled={disabled} className="cave-approve__question">
          <legend>{question.prompt}</legend>
          <div className="cave-approve__options" role="radiogroup" aria-label={question.prompt}>
            {question.options.map((option) => (
              <label key={option} className="cave-approve__option">
                <input
                  type="radio"
                  className="focus-ring"
                  name={`${id}-${index}`}
                  checked={!other[question.id] && answers[question.id] === option}
                  onChange={() => {
                    setOther((previous) => ({ ...previous, [question.id]: false }));
                    setAnswers((previous) => ({ ...previous, [question.id]: option }));
                    setError(null);
                  }}
                />
                <span>{option}</span>
              </label>
            ))}
            {question.allowOther ? (
              <label className="cave-approve__option">
                <input
                  type="radio"
                  className="focus-ring"
                  name={`${id}-${index}`}
                  checked={Boolean(other[question.id])}
                  onChange={() => {
                    setOther((previous) => ({ ...previous, [question.id]: true }));
                    setAnswers((previous) => ({ ...previous, [question.id]: "" }));
                    setError(null);
                  }}
                />
                <span>Other</span>
              </label>
            ) : null}
          </div>
          {other[question.id] ? (
            <label className="cave-approve__other">
              <span>Your answer</span>
              <input
                type="text"
                className="ui-input focus-ring"
                aria-label={`Other answer for: ${question.prompt}`}
                value={answers[question.id] ?? ""}
                onChange={(event) => {
                  // Keep spaces while typing; trim only at the submission boundary.
                  setAnswers((previous) => ({ ...previous, [question.id]: event.target.value }));
                  setError(null);
                }}
              />
            </label>
          ) : null}
        </fieldset>
      ))}
      {error ? <p className="cave-approve__error" role="alert" id={`${id}-error`}>{error}</p> : null}
      {disabledReason ? <p className="cave-approve__help">{disabledReason}</p> : null}
      <div className="cave-approve__actions">
        <Button
          type="submit"
          size="sm"
          className="focus-ring"
          loading={phase === "sending"}
          disabled={disabled || answeredCount === 0}
          aria-describedby={error ? `${id}-error` : `${id}-help`}
        >
          {phase === "sending" ? "Sending answers…" : "Send answers"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="focus-ring"
          disabled={disabled}
          onClick={() => {
            setPhase("skipped");
            announce("Questions skipped. No message sent.");
            requestAnimationFrame(() => summaryRef.current?.focus());
          }}
        >
          Skip
        </Button>
        {answeredCount < request.questions.length ? (
          <span className="cave-approve__help">{request.questions.length - answeredCount} unanswered</span>
        ) : null}
      </div>
    </form>
  );
}
