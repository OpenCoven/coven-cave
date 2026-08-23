"use client";

/**
 * ChatApproveCard — the `<coven:approve kind="questions" …>` inline decision
 * card (bead cave-8k9bc; design
 * docs/superpowers/specs/2026-08-20-aicss-chat-approval-and-composer-adaptation-design.md).
 *
 * Presentation-only, deliberately. The card collects choices and hands them
 * back through `onSubmit`; the chat surface keeps ownership of routing and of
 * anything that reaches the send path — the same split FollowUpCards uses, and
 * for the same reason: a card gesture must stay distinct from sending text.
 *
 * Two properties of the upstream component (AICSS Approval Card) are
 * deliberately NOT reproduced:
 *
 *  - its 30-second auto-approve countdown, which decides for a human who never
 *    answered. An unanswered card here produces nothing, forever.
 *  - its "View Plan" decline label, which names a navigation where an action
 *    belongs. The decline here says Skip and means it.
 *
 * Announcements go through a LOCAL live region rather than `useAnnouncer()`,
 * so the card works anywhere it is mounted (the app announcer throws outside
 * its provider) — the same choice image-carousel.tsx made.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  formatApproveAnswers,
  type ApproveQuestion,
  type ApproveRequestDescriptor,
} from "@/lib/approve-blocks";

/** Delay before a chosen option steps to the next question, so the choice is
 *  visibly registered first. Collapsed to 0 under reduced motion. */
const ADVANCE_MS = 320;

type Phase = "asking" | "sent" | "skipped";

export type ChatApproveCardProps = {
  request: ApproveRequestDescriptor;
  /** Receives the ordered answers. The host decides what to do with them —
   *  this card never sends anything itself. */
  onSubmit?: (result: { answers: Record<string, string>; text: string }) => void;
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function ChatApproveCard({ request, onSubmit }: ChatApproveCardProps) {
  const questions = request.questions;
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<Phase>("asking");
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const otherInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    [],
  );

  const safeStep = Math.min(step, Math.max(questions.length - 1, 0));
  const question: ApproveQuestion | undefined = questions[safeStep];
  const answeredCount = questions.filter((q) => Boolean(answers[q.id]?.trim())).length;
  const unanswered = questions.length - answeredCount;

  const advance = useCallback(
    (from: number) => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      if (from >= questions.length - 1) return;
      const go = () => setStep((s) => Math.min(s + 1, questions.length - 1));
      if (prefersReducedMotion()) {
        go();
        return;
      }
      advanceTimer.current = setTimeout(go, ADVANCE_MS);
    },
    [questions.length],
  );

  const choose = useCallback(
    (questionId: string, option: string) => {
      setOtherOpen((prev) => ({ ...prev, [questionId]: false }));
      setAnswers((prev) => ({ ...prev, [questionId]: option }));
      advance(safeStep);
    },
    [advance, safeStep],
  );

  const openOther = useCallback(
    (questionId: string) => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      setOtherOpen((prev) => ({ ...prev, [questionId]: true }));
      // Free text replaces any chosen option; leaving the old choice selected
      // would make the card claim an answer the human just moved away from.
      setAnswers((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
      requestAnimationFrame(() => otherInputRef.current?.focus());
    },
    [],
  );

  const writeOther = useCallback((questionId: string, text: string) => {
    setAnswers((prev) => {
      const next = { ...prev };
      const trimmed = text.trim();
      if (trimmed) next[questionId] = trimmed;
      else delete next[questionId];
      return next;
    });
  }, []);

  const submit = useCallback(() => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    const text = formatApproveAnswers(request, answers);
    if (!text) return;
    setPhase("sent");
    onSubmit?.({ answers, text });
  }, [answers, onSubmit, request]);

  if (!question) return null;

  const shell =
    "cave-approve flex items-start gap-2.5 rounded-md border border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-raised)_78%,transparent)] px-3 py-2";
  const btn =
    "focus-ring rounded border px-2 py-0.5 text-[length:var(--text-2xs)] transition-colors disabled:opacity-50";

  if (phase !== "asking") {
    const summary =
      phase === "sent"
        ? formatApproveAnswers(request, answers).split("\n").join(" · ")
        : "Questions skipped";
    return (
      <div className={shell} data-approve-phase={phase}>
        <span aria-hidden className="mt-[2px] inline-flex shrink-0 text-[var(--text-secondary)]">
          <Icon name={phase === "sent" ? "ph:check-circle" : "ph:chat-circle-dots"} width={14} />
        </span>
        <div className="min-w-0 flex-1 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
          {summary}
        </div>
      </div>
    );
  }

  const otherActive = Boolean(otherOpen[question.id]);
  const chosen = answers[question.id];

  return (
    <div className={shell} data-approve-phase={phase} data-approve-step={safeStep}>
      <span aria-hidden className="mt-[2px] inline-flex shrink-0 text-[var(--accent-presence)]">
        <Icon name="ph:chat-circle-dots" width={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <div className="text-[length:var(--text-sm)] font-medium text-[var(--text-primary)]">
            Questions
          </div>
          {questions.length > 1 ? (
            <div className="text-[length:var(--text-2xs)] text-[var(--text-secondary)]">
              {safeStep + 1} / {questions.length}
            </div>
          ) : null}
        </div>

        <div className="mt-1 text-[length:var(--text-sm)] text-[var(--text-primary)]">
          {question.prompt}
        </div>

        <div
          role="radiogroup"
          aria-label={question.prompt}
          className="mt-1.5 flex flex-wrap items-center gap-1.5"
        >
          {question.options.map((option) => {
            const selected = !otherActive && chosen === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`${btn} ${
                  selected
                    ? "border-[var(--accent-presence)] bg-[color-mix(in_oklch,var(--accent-presence)_14%,transparent)] text-[var(--text-primary)]"
                    : "border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                }`}
                onClick={() => choose(question.id, option)}
              >
                {option}
              </button>
            );
          })}
          {question.allowOther ? (
            <button
              type="button"
              role="radio"
              aria-checked={otherActive}
              className={`${btn} ${
                otherActive
                  ? "border-[var(--accent-presence)] bg-[color-mix(in_oklch,var(--accent-presence)_14%,transparent)] text-[var(--text-primary)]"
                  : "border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
              onClick={() => openOther(question.id)}
            >
              Other
            </button>
          ) : null}
        </div>

        {otherActive ? (
          <input
            ref={otherInputRef}
            type="text"
            className="focus-ring mt-1.5 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-base)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--text-primary)]"
            placeholder="Type an answer…"
            aria-label={`Other answer for: ${question.prompt}`}
            value={chosen ?? ""}
            onChange={(e) => writeOther(question.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (safeStep < questions.length - 1) advance(safeStep);
            }}
          />
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {questions.length > 1
            ? questions.map((q, i) => (
                <button
                  key={q.id}
                  type="button"
                  aria-label={`Go to question ${i + 1}: ${q.prompt}`}
                  aria-current={i === safeStep}
                  className={`focus-ring h-1.5 w-4 rounded-full transition-colors ${
                    i === safeStep
                      ? "bg-[var(--accent-presence)]"
                      : answers[q.id]
                        ? "bg-[var(--border-strong)]"
                        : "bg-[var(--border-hairline)]"
                  }`}
                  onClick={() => {
                    if (advanceTimer.current) clearTimeout(advanceTimer.current);
                    setStep(i);
                  }}
                />
              ))
            : null}

          <button
            type="button"
            className={`${btn} border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]`}
            onClick={submit}
            disabled={answeredCount === 0}
          >
            Send answers
          </button>
          <button
            type="button"
            className={`${btn} border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]`}
            onClick={() => setPhase("skipped")}
          >
            Skip
          </button>
          {answeredCount > 0 && unanswered > 0 ? (
            <span className="text-[length:var(--text-2xs)] text-[var(--text-secondary)]">
              {unanswered} unanswered
            </span>
          ) : null}
        </div>

        {/* Local live region: the card announces its own step changes, so it
            works outside a LiveRegionProvider (useAnnouncer throws there). */}
        <span className="sr-only" role="status" aria-live="polite">
          {questions.length > 1
            ? `Question ${safeStep + 1} of ${questions.length}: ${question.prompt}`
            : ""}
        </span>
      </div>
    </div>
  );
}
