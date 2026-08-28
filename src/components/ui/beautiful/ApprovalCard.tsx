"use client";

import { useState, type ReactNode } from "react";

/* ─────────────────────────────────────────────────────────
 * APPROVAL CARD (human-in-the-loop)
 *
 * Parameterized so one card serves two presentations:
 *
 *   1. Question queue (default) — one question at a time;
 *      elongated pills show progress; the circular arrow up top
 *      advances (↑ sends on the last). Choices, paging, and
 *      submission are directly controlled. `variant` selects the
 *      question set from VARIANTS; `questions` passes one inline.
 *   2. Permission prompt — a single allow/deny decision over a
 *      named resource and a list of requested scopes, tinted by
 *      `kind`. This is the shape permission/authorization
 *      surfaces need.
 *
 * Backward compatible: with no props the card renders the
 * "Questions" variant — upstream's fixture — verbatim.
 * ───────────────────────────────────────────────────────── */

export type ApprovalQuestionType = "radio" | "check";

export type ApprovalQuestion = {
  /** The question text. */
  q: string;
  /** Single-choice (radio) or multi-select (check). */
  type: ApprovalQuestionType;
  /** The options the human picks from. */
  options: string[];
  /** Allow a free-text answer in addition to the listed options. */
  allowCustom?: boolean;
};

export interface PermissionScope {
  /** What is being requested, e.g. "Read access". */
  label: string;
  /** Optional clarifying detail, e.g. "Public repositories only". */
  detail?: string;
}

/** Severity tint for a permission prompt. `neutral` changes nothing. */
export type ApprovalCardKind = "neutral" | "info" | "warning" | "danger";

export interface ApprovalAnswers {
  /** Selected option indices keyed by question index. */
  selected: Record<number, number[]>;
  /** Free-text answers keyed by question index. */
  custom: Record<number, string>;
}

export interface ApprovalCardProps {
  /** Which question set to render inline (see VARIANTS). Defaults to "Questions". */
  variant?: string;
  /** Card title, shown above the question body / scope list. */
  title?: string;
  /** Explanatory copy shown beneath the title. */
  description?: string;
  /** An inline question queue; takes precedence over `variant`. */
  questions?: ApprovalQuestion[];
  /** Severity tint for permission prompts. */
  kind?: ApprovalCardKind;

  /** Verb labels (all optional, with the fixture defaults). */
  openLabel?: string;
  dismissLabel?: string;
  restartLabel?: string;
  sentLabel?: string;
  previousLabel?: string;
  nextLabel?: string;
  /** Label for the send arrow when it advances to the next question. */
  advanceLabel?: string;
  sendLabel?: string;
  customPlaceholder?: string;
  customLabel?: string;

  /** Permission-prompt payload — renders instead of the question queue. */
  resourceName?: string;
  scopes?: PermissionScope[];
  allowLabel?: string;
  denyLabel?: string;

  /** Custom body content, rendered in place of the question queue or scope list. */
  children?: ReactNode;
  /** Custom footer content, rendered in place of the pager or allow/deny row. */
  footer?: ReactNode;

  /** Callbacks. */
  onSubmit?: (answers: ApprovalAnswers) => void;
  onDismiss?: () => void;
  onAllow?: () => void;
  onDeny?: () => void;
}

const QUESTIONS: ApprovalQuestion[] = [
  {
    q: "How many flavors should we launch?",
    type: "radio",
    options: ["Three (core line)", "Five (full case)", "Just one hero"],
  },
  {
    q: "Which mix-ins should we stock?",
    type: "check",
    options: ["Chocolate chips", "Waffle bits", "Sprinkles"],
  },
  {
    q: "Which market do we enter first?",
    type: "radio",
    options: ["Food trucks", "Grocery freezers", "Scoop shops"],
  },
];

const VARIANTS: Record<string, ApprovalQuestion[]> = {
  Questions: QUESTIONS,
};

const KIND_META: Record<
  ApprovalCardKind,
  { label: string; text: string; tint: string; dot: string }
> = {
  neutral: { label: "Permission request", text: "text-bui-ink-2", tint: "bg-bui-field", dot: "bg-bui-ink-3" },
  info: { label: "Permission request", text: "text-bui-accent-ink", tint: "bg-bui-accent-tint", dot: "bg-bui-accent" },
  warning: { label: "Heads up", text: "text-bui-orange-text", tint: "bg-bui-orange-tint", dot: "bg-bui-orange" },
  danger: { label: "Danger", text: "text-bui-red-text", tint: "bg-bui-red-tint", dot: "bg-bui-red" },
};

function DismissButton({ label, onDismiss }: { label: string; onDismiss: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onDismiss}
      className="primitive-icon-button shrink-0
        text-bui-ink-3 transition-colors duration-100 hover:bg-bui-hover hover:text-bui-ink"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    </button>
  );
}

export function ApprovalCard({
  variant = "Questions",
  title,
  description,
  questions,
  kind = "neutral",
  openLabel = "Open approval",
  dismissLabel = "Dismiss",
  restartLabel = "Start over",
  sentLabel = "Answers sent",
  previousLabel = "Previous",
  nextLabel = "Next",
  advanceLabel = "Next question",
  sendLabel = "Send answers",
  customPlaceholder = "Type something…",
  customLabel = "Custom answer",
  resourceName,
  scopes,
  allowLabel = "Allow",
  denyLabel = "Deny",
  children,
  footer,
  onSubmit,
  onDismiss,
  onAllow,
  onDeny,
}: ApprovalCardProps) {
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [sent, setSent] = useState(false);
  const [open, setOpen] = useState(true);

  const queue = questions ?? VARIANTS[variant] ?? VARIANTS.Questions;
  const isPermission = Boolean(resourceName || (scopes && scopes.length > 0));
  const question = queue[qi];
  const last = qi === queue.length - 1;
  const selected = answers[qi] ?? [];
  const hasAnswer = selected.length > 0 || Boolean(custom[qi]?.trim());
  const kindMeta = KIND_META[kind];

  const finish = () => {
    setSent(true);
    onSubmit?.({ selected: answers, custom });
  };

  const dismiss = () => {
    setOpen(false);
    onDismiss?.();
  };

  const toggle = (index: number) => {
    const picked = answers[qi] ?? [];
    const next = question.type === "radio"
      ? [index]
      : picked.includes(index)
        ? picked.filter((item) => item !== index)
        : [...picked, index];
    setAnswers((current) => ({ ...current, [qi]: next }));
    if (question.type === "radio") {
      setCustom((current) => ({ ...current, [qi]: "" }));
      // single-choice auto-advances
      window.setTimeout(() => {
        if (qi === queue.length - 1) {
          setSent(true);
          onSubmit?.({ selected: { ...answers, [qi]: next }, custom: { ...custom, [qi]: "" } });
        } else {
          setQi((current) => Math.min(queue.length - 1, current + 1));
        }
      }, 480);
    }
  };

  const reset = () => {
    setQi(0);
    setAnswers({});
    setCustom({});
    setSent(false);
    setOpen(true);
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-bui-control bg-bui-surface px-3 py-2 text-[length:var(--text-base)] font-medium text-bui-ink shadow-bui-btn transition-colors duration-150 hover:bg-bui-hover">
        {openLabel}
      </button>
    );
  }

  const headerContent = title || description ? (
    <div className="flex min-w-0 flex-col gap-0.5">
      {title ? (
        <span className="text-[length:var(--text-md)] font-medium text-bui-ink">{title}</span>
      ) : null}
      {description ? (
        <span className="text-[length:var(--text-sm)] text-bui-ink-2">{description}</span>
      ) : null}
    </div>
  ) : null;

  let body: ReactNode;
  if (children) {
    body = <div className="primitive-card-pad">{children}</div>;
  } else if (isPermission) {
    body = (
      <div className="primitive-card-pad flex flex-col gap-3">
        <header className="flex items-start justify-between gap-3">
          {headerContent}
          <DismissButton label={dismissLabel} onDismiss={dismiss} />
        </header>
        {kind !== "neutral" ? (
          <span className={`inline-flex w-fit items-center gap-1.5 rounded-bui-chip px-2 py-0.5 text-[length:var(--text-xs)] font-medium ${kindMeta.text} ${kindMeta.tint}`}>
            <span aria-hidden="true" className={`size-1.5 rounded-full ${kindMeta.dot}`} />
            {kindMeta.label}
          </span>
        ) : null}
        {resourceName ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-[length:var(--text-xs)] font-medium uppercase tracking-wide text-bui-ink-3">
              Resource
            </span>
            <span className="truncate text-[length:var(--text-base)] font-medium text-bui-ink">
              {resourceName}
            </span>
          </div>
        ) : null}
        {scopes && scopes.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-[length:var(--text-xs)] font-medium uppercase tracking-wide text-bui-ink-3">
              Requested scopes
            </span>
            <ul className="flex flex-col gap-1">
              {scopes.map((scope) => (
                <li key={scope.label} className="flex items-start gap-2 rounded-bui-control px-1.5 py-1">
                  <span aria-hidden="true" className={`mt-1 size-1.5 shrink-0 rounded-full ${kindMeta.dot}`} />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[length:var(--text-base)] text-bui-ink">{scope.label}</span>
                    {scope.detail ? (
                      <span className="text-[length:var(--text-sm)] text-bui-ink-2">{scope.detail}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  } else if (sent) {
    body = (
      <div className="flex h-37 flex-col items-center justify-center gap-2">
        <span
          className="flex size-6 items-center justify-center rounded-full bg-bui-green text-bui-green-ink [animation:bui-pop-in_300ms_cubic-bezier(0.23,1,0.32,1)_both]!"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        </span>
        <span className="text-[length:var(--text-base)] font-medium text-bui-ink [animation:bui-fade-up_350ms_cubic-bezier(0.23,1,0.32,1)_100ms_both]!">
          {sentLabel}
        </span>
        <button type="button" onClick={reset} className="text-[length:var(--text-sm)] font-medium text-bui-accent-ink hover:underline">
          {restartLabel}
        </button>
      </div>
    );
  } else {
    body = (
      <div key={qi} className="primitive-card-pad [animation:bui-fade-up_350ms_cubic-bezier(0.23,1,0.32,1)_both]!">
        {headerContent ? (
          <header className="mb-2 flex items-start justify-between gap-3">
            {headerContent}
            <DismissButton label={dismissLabel} onDismiss={dismiss} />
          </header>
        ) : null}
        <div className="flex items-start justify-between gap-3">
          <span className="text-[length:var(--text-base)] font-medium text-bui-ink">{question.q}</span>
          {!headerContent ? <DismissButton label={dismissLabel} onDismiss={dismiss} /> : null}
        </div>
        <div className="mt-2 flex flex-col gap-0.5">
          {question.options.map((option, i) => {
            const on = selected.includes(i);
            return (
              <button
                key={option}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(i)}
                className="-mx-1.5 flex items-center gap-2 rounded-bui-control px-1.5 py-1 text-left transition-colors duration-100 hover:bg-bui-hover"
              >
                <span
                  className={`flex size-4 shrink-0 items-center justify-center transition-colors duration-200
                    ${question.type === "radio" ? "rounded-full" : "rounded-[5px]"}
                    ${on ? "bg-bui-ink text-bui-canvas" : "shadow-[inset_0_0_0_1.5px_var(--bui-line-strong)] text-transparent"}`}
                >
                  {question.type === "radio" ? (
                    <span className="size-1.5 rounded-full bg-bui-canvas transition-transform duration-200" style={{ transform: on ? "scale(1)" : "scale(0)" }} />
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  )}
                </span>
                <span className={`text-[length:var(--text-base)] transition-colors duration-200 ${on ? "text-bui-ink" : "text-bui-ink-2"}`}>
                  {option}
                </span>
              </button>
            );
          })}
          {question.allowCustom !== false ? (
            <label className="-mx-1.5 flex items-center gap-2 rounded-bui-control px-1.5 py-1 transition-colors duration-100 focus-within:bg-bui-hover hover:bg-bui-hover">
              <span aria-hidden="true" className="size-4 shrink-0" />
              <input
                value={custom[qi] ?? ""}
                onChange={(event) => {
                  setCustom((current) => ({ ...current, [qi]: event.target.value }));
                  if (question.type === "radio") setAnswers((current) => ({ ...current, [qi]: [] }));
                }}
                placeholder={customPlaceholder}
                aria-label={customLabel}
                className="min-w-0 flex-1 bg-transparent text-[length:var(--text-base)] text-bui-ink outline-none placeholder:text-bui-ink-3"
              />
            </label>
          ) : null}
        </div>
      </div>
    );
  }

  const questionFooter = (
    <div className="primitive-card-footer flex items-center justify-between">
      <span className="flex items-center gap-2">
        <button
          type="button"
          aria-label={previousLabel}
          disabled={qi === 0 || sent}
          onClick={() => setQi((current) => Math.max(0, current - 1))}
          className="flex size-6 items-center justify-center rounded-[5px] text-bui-ink-3 transition-colors duration-100 enabled:hover:bg-bui-hover enabled:hover:text-bui-ink-2 disabled:opacity-35"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <span className="flex items-center gap-1">
          {queue.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to question ${i + 1}`}
              aria-current={i === qi && !sent ? "step" : undefined}
              disabled={sent}
              onClick={() => setQi(i)}
              className="rounded-full transition-all duration-300 disabled:cursor-default"
              style={
                i === qi && !sent
                  ? { width: 9, height: 9, border: "2.5px solid var(--bui-ink)" }
                  : sent || i < qi
                    ? { width: 7, height: 7, background: "var(--bui-ink-3)" }
                    : { width: 7, height: 7, border: "1.5px solid var(--bui-ink-3)" }
              }
            />
          ))}
        </span>
        <button
          type="button"
          aria-label={nextLabel}
          disabled={last || sent}
          onClick={() => setQi((current) => Math.min(queue.length - 1, current + 1))}
          className="flex size-6 items-center justify-center rounded-[5px] text-bui-ink-3 transition-colors duration-100 enabled:hover:bg-bui-hover enabled:hover:text-bui-ink-2 disabled:opacity-35"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </span>
      {!sent && (
        <button
          type="button"
          aria-label={last ? sendLabel : advanceLabel}
          disabled={!hasAnswer}
          onClick={() => last ? finish() : setQi((current) => current + 1)}
          className="-mr-0.5 flex size-7 items-center justify-center rounded-[var(--radius-control)] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.96]"
          style={{
            background: hasAnswer ? "var(--bui-ink)" : "var(--bui-field)",
            color: hasAnswer ? "var(--bui-surface)" : "var(--bui-ink-3)",
            boxShadow: hasAnswer ? "inset 0 1px 0 rgba(255,255,255,0.14)" : "var(--bui-shadow-bui-btn)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      )}
    </div>
  );

  const permissionFooter = (
    <div className="primitive-card-footer flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onDeny}
        className="rounded-bui-control bg-bui-field px-3 py-1.5 text-[length:var(--text-base)] font-medium text-bui-ink shadow-bui-btn transition-colors duration-150 hover:bg-bui-hover"
      >
        {denyLabel}
      </button>
      <button
        type="button"
        onClick={onAllow}
        className="rounded-bui-control bg-bui-ink px-3 py-1.5 text-[length:var(--text-base)] font-medium text-bui-surface transition-[background-color,color,transform] duration-150 enabled:active:scale-[0.96]"
      >
        {allowLabel}
      </button>
    </div>
  );

  return (
    <div className="flex min-h-[196px] w-full max-w-80 flex-col items-stretch">
      <div className="w-full self-start overflow-hidden rounded-bui-card bg-bui-surface shadow-bui-card">
        {body}
        {footer ?? (isPermission ? permissionFooter : questionFooter)}
      </div>
    </div>
  );
}
