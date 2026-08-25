// The plan a scheduling surface echoes back while you type: what will happen,
// and when it will next happen.
//
// `Scheduling Spec.dc.html` (the implementation spec behind
// `Rituals Redesign.dc.html`) states the contract this exists to satisfy —
// *"every schedule surface says what will happen and when it will next
// happen"* — and files its absence in the cron dialog as a P0: users cannot
// tell what they built until it runs. The reminder dialog already earned that
// trust; this is the shared model so the two cannot drift into disagreeing
// about the same phrase.
//
// Pure and client-safe: it composes `parseWhen` (phrase → recurrence) with
// `describeRecurrence` (recurrence → sentence) and `nextOccurrences`
// (recurrence → concrete fires). It adds no parsing of its own, so there is
// exactly one definition of what a phrase means.

import type { Recurrence } from "./inbox-recurrence.ts";
import { parseWhen } from "./parse-when.ts";
import { describeRecurrence, nextOccurrences } from "./schedule-plan.ts";
import { RRULE_DAY_ORDER, parseCodexRrule } from "./codex-automation-form.ts";

/**
 * Three states, not the frame's four.
 *
 * The prototype also draws an *ambiguous* "TWO READINGS" state — "every other
 * tuesday" meaning this week or next, "at 4" meaning morning or afternoon.
 * That is **cut rather than faked**: `parseWhen` resolves every phrase to a
 * single reading and does not report the alternatives it discarded, so a
 * "pick one" prompt would have to re-parse the phrase with a second, competing
 * parser — and two parsers disagreeing about the same string is a worse defect
 * than not offering the choice. Surfacing it honestly means teaching
 * `parseWhen` to return candidates first; tracked separately.
 */
export type SchedulePlan =
  | { kind: "empty" }
  | { kind: "unparsed"; hint: string }
  | {
      kind: "parsed";
      /** Cadence sentence, or the one-shot's own description. */
      sentence: string;
      /** Concrete upcoming fires, ISO. Empty for a one-shot beyond the first. */
      nextRuns: string[];
      recurrence: Recurrence;
      fireAt: string;
    };

/** How many upcoming fires the preview shows. The spec asks for three. */
export const SCHEDULE_PLAN_RUN_COUNT = 3;

const RRULE_HINT =
  "this rule can't be translated to a plain-language plan — the daily and weekly builders can";

const DEFAULT_HINT =
  'try "weekdays at 9am", "every tuesday 4pm", or "tomorrow at 09:30"';

/**
 * Derive the plan for a typed phrase.
 *
 * `now` is injected rather than read from the clock so the caller controls the
 * frame of reference and the model stays testable — "tomorrow at 9am" has to
 * mean something fixed for a given now.
 */
export function planFromPhrase(
  phrase: string,
  now: Date = new Date(),
  opts: { hour12?: boolean } = {},
): SchedulePlan {
  const trimmed = phrase.trim();
  if (!trimmed) return { kind: "empty" };

  const parsed = parseWhen(trimmed, now);
  if (!parsed) return { kind: "unparsed", hint: DEFAULT_HINT };

  const cadence = describeRecurrence(parsed.recurrence, opts);
  // A one-shot has no cadence — its fire time IS the description, so the
  // sentence falls back to the single occurrence rather than reading blank.
  const sentence = cadence ?? "once";
  const nextRuns =
    parsed.recurrence.type === "none"
      ? [parsed.fireAt]
      : nextOccurrences(parsed.recurrence, now.getTime(), SCHEDULE_PLAN_RUN_COUNT);

  return {
    kind: "parsed",
    sentence,
    nextRuns,
    recurrence: parsed.recurrence,
    fireAt: parsed.fireAt,
  };
}

/**
 * The outcome-naming half of the spec's CTA rule: *"'+ Create' never says what
 * it creates"* → label the button with what it will do. Returns null when
 * there is no plan to name, so the caller keeps its neutral label rather than
 * inventing one.
 */
export function planCtaSuffix(plan: SchedulePlan): string | null {
  return plan.kind === "parsed" ? plan.sentence : null;
}

/**
 * The same plan, derived from an RRULE instead of a phrase.
 *
 * This is what lets the spec's *"all three syntaxes reconcile into one
 * canonical plan"* hold: the cron dialog's daily builder, its weekly builder
 * and its raw RRULE box all serialize to an RRULE, so translating THAT gives
 * one preview for every input mode rather than three that can disagree.
 *
 * `parseCodexRrule` self-reports an RRULE it does not recognise as
 * `mode: "raw"`, which is the honest signal we need: an exotic rule is
 * reported as untranslatable rather than silently rendered as some nearby
 * schedule the user did not ask for.
 */
/**
 * An RRULE as a `Recurrence`, or null when it cannot be expressed as one.
 *
 * Extracted so every surface that has to understand a cron's schedule — the
 * create dialog's plan preview, the calendar's projection — reads it through
 * ONE definition. Two readers with their own RRULE handling is how a calendar
 * ends up drawing a cadence the dialog never promised.
 *
 * Returns null rather than approximating: an exotic rule (`FREQ=SECONDLY`, a
 * weekly rule with no day yet) is unrepresentable here, and guessing a nearby
 * schedule would put fires on a calendar that will never happen.
 */
export function recurrenceFromRrule(rrule: string): Recurrence | null {
  const trimmed = rrule.trim();
  if (!trimmed) return null;

  // `parseCodexRrule` answers an EMPTY `BYDAY=` with all seven days, which is a
  // reasonable default for a stored rule but a lie for one being composed: a
  // weekly schedule with no day picked yet would read as "every day", a cadence
  // the user never chose. Catch the empty list before that substitution.
  if (/FREQ=WEEKLY/i.test(trimmed) && /BYDAY=\s*(?:;|$)/i.test(trimmed)) return null;

  const parsed = parseCodexRrule(trimmed);
  const [rawHour, rawMinute] = parsed.time.split(":");
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  if (parsed.mode === "daily") return { type: "daily", hour, minute };
  if (parsed.mode === "weekly") {
    const days = parsed.days
      .map((day) => RRULE_DAY_ORDER.indexOf(day))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b);
    // A weekly rule naming no day it can act on fires never.
    if (days.length === 0) return null;
    return { type: "weekly", days, hour, minute };
  }
  return null;
}

export function planFromRrule(
  rrule: string,
  now: Date = new Date(),
  opts: { hour12?: boolean } = {},
): SchedulePlan {
  const trimmed = rrule.trim();
  if (!trimmed) return { kind: "empty" };

  const rec = recurrenceFromRrule(trimmed);
  if (!rec) {
    // The one distinction worth keeping in the UI: a weekly rule mid-edit is
    // incomplete and fixable by picking a day; anything else is genuinely
    // untranslatable, and saying so is more use than "invalid".
    const midEdit = /FREQ=WEEKLY/i.test(trimmed) && /BYDAY=\s*(?:;|$)/i.test(trimmed);
    return {
      kind: "unparsed",
      hint: midEdit ? "pick at least one day for a weekly schedule" : RRULE_HINT,
    };
  }

  const sentence = describeRecurrence(rec, opts);
  if (!sentence) return { kind: "unparsed", hint: RRULE_HINT };

  return {
    kind: "parsed",
    sentence,
    nextRuns: nextOccurrences(rec, now.getTime(), SCHEDULE_PLAN_RUN_COUNT),
    recurrence: rec,
    fireAt: nextOccurrences(rec, now.getTime(), 1)[0] ?? "",
  };
}
