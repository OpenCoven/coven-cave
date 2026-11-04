"use client";

import { useId, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import {
  RRULE_DAY_ORDER,
  RRULE_DAY_LABEL,
  buildCodexRrule,
  composeAutomationPrompt,
  type ScheduleMode,
} from "@/lib/codex-automation-form";
import { StandardSelect } from "@/components/ui/select";
import { CwdPickerField } from "@/components/cwd-picker-field";
import { Button } from "@/components/ui/button";
import { parseListInput } from "@/lib/automations/list-input";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import { CronPromptBar } from "@/components/cron-prompt-bar";
import { SchedulePlanPreview } from "@/components/schedule/schedule-plan-preview";
import { planCtaSuffix, planFromRrule } from "@/lib/schedule-plan-model";
import { readDateTimePrefs } from "@/lib/datetime-format";
import type { CronPromptUpdate } from "@/lib/cron-prompt";

export type AutomationCreateInput = {
  name: string;
  rrule: string;
  prompt: string;
  cwds: string[];
  tags: string[];
  familiars: string[];
  model: string;
  /** New definitions are paused. `active` requests a separate review of the
   * stored definition before a revision-checked activation. */
  start: "paused" | "active";
};

type Props = {
  resolvedFamiliars: ResolvedFamiliar[];
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onCreate: (input: AutomationCreateInput) => void;
};

const fieldBaseClass =
  "w-full rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--border-strong)]";
const inputClass = `${fieldBaseClass} h-8 px-2 text-[length:var(--text-sm)]`;
const textareaClass = `${fieldBaseClass} resize-y px-2 py-2 text-[length:var(--text-sm)] leading-relaxed`;
const monoTextareaClass = `${textareaClass} font-mono text-[length:var(--text-xs)]`;

export function AutomationCreateDialog({ resolvedFamiliars, onClose, onCreate, busy = false, error }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const familiarHelpId = useId();
  useFocusTrap(true, dialogRef, { onEscape: onClose, focusFirst: false });

  const [name, setName] = useState("");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("daily");
  const [time, setTime] = useState("09:00");
  const [days, setDays] = useState<string[]>([]);
  const [rawRrule, setRawRrule] = useState("");
  const [goals, setGoals] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [model, setModel] = useState("");
  const [cwds, setCwds] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [selected, setSelected] = useState("");
  const [start, setStart] = useState<AutomationCreateInput["start"]>("paused");

  const toggleDay = (day: string) => {
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  };

  // Prompt-driven generate (CronPromptBar): one sentence fills the form —
  // schedule, name, goals, deliverables — and the user reviews before Create.
  const applyPromptUpdate = (update: CronPromptUpdate) => {
    if (update.schedule) {
      if (update.schedule.mode) setScheduleMode(update.schedule.mode);
      if (update.schedule.time) setTime(update.schedule.time);
      if (update.schedule.days) setDays(update.schedule.days);
    }
    if (update.name) setName(update.name);
    if (update.goals) {
      setGoals((prev) =>
        update.goalsOp === "append" && prev.trim() ? `${prev.trimEnd()}\n${update.goals}` : update.goals!,
      );
    }
    if (update.deliverables) {
      setDeliverables((prev) =>
        update.deliverablesOp === "append" && prev.trim()
          ? `${prev.trimEnd()}\n${update.deliverables}`
          : update.deliverables!,
      );
    }
  };

  const rrule = buildCodexRrule(scheduleMode, time, days, rawRrule);
  // ONE plan for all three input modes. The weekly builder, the daily builder
  // and the raw RRULE box all serialize through buildCodexRrule, so reading
  // the plan off THAT is what makes the spec's "all three syntaxes reconcile
  // into one canonical plan" true rather than aspirational — three separate
  // previews could disagree about the same schedule.
  // Same clock the reminder modal reads, so the two dialogs render a schedule
  // the same way rather than one saying "9 AM" while the other says "09:00".
  const plan = planFromRrule(rrule, new Date(), { hour12: readDateTimePrefs().clock !== "24h" });
  const planLabel = planCtaSuffix(plan);
  const validSchedule =
    scheduleMode === "raw"
      ? rawRrule.trim().startsWith("RRULE:")
      : scheduleMode === "weekly"
        ? days.length > 0
        : true; // daily is always valid

  const canCreate = !busy && name.trim().length > 0 && validSchedule && selected.length > 0 && parseListInput(cwds).length <= 1;

  const handleCreate = () => {
    if (!canCreate) return;
    const prompt = composeAutomationPrompt(goals, deliverables, true);
    onCreate({
      name: name.trim(),
      rrule,
      prompt,
      cwds: parseListInput(cwds),
      tags: parseListInput(tagsText),
      familiars: [selected],
      model: model.trim(),
      start,
    });
  };

  return (
    <div className="workflow-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="workflow-dialog automation-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="New automation"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="workflow-panel-heading automation-create-dialog__hero">
          <div>
            <p className="workflow-eyebrow">New automation</p>
            <h2>Schedule a Codex run</h2>
          </div>
          <Button
            variant="ghost"
            className="workflow-icon-button p-0"
            onClick={onClose}
            aria-label="Close"
            leadingIcon="ph:x"
          />
        </div>

        <div className="automation-create-dialog__body">
          <CronPromptBar
            onApply={applyPromptUpdate}
            placeholder='Describe it — "name it Nightly triage, every weekday at 9am, check open PRs"'
          />

          <section className="automation-create-dialog__section" aria-label="Essentials">
            <div className="automation-create-dialog__section-header">
              <h3>Essentials</h3>
            </div>
            <div className="automation-create-dialog__primary-grid">
              <label className="workflow-field automation-create-dialog__field">
                <span>Name</span>
                <input
                  type="text"
                  value={name}
                  autoFocus
                  placeholder="Nightly code review"
                  onChange={(event) => setName(event.target.value)}
                  className={inputClass}
                />
              </label>

              <div className="workflow-field automation-create-dialog__field automation-create-dialog__schedule">
                <span>Schedule</span>
                <div className="automation-create-dialog__schedule-card">
                  <div
                    className="automation-create-dialog__segment-control [border-color:var(--border-hairline)]! [background:var(--bg-base)]!"
                  >
                    {(["weekly", "daily", "raw"] as const).map((mode) => (
                      <Button
                        key={mode}
                        variant="ghost"
                        size="xs"
                        onClick={() => setScheduleMode(mode)}
                        className="rounded-[var(--radius-control)] px-2 py-1 text-[length:var(--text-xs)] capitalize transition-colors"
                        style={{
                          background: scheduleMode === mode ? "rgba(255,255,255,0.08)" : "transparent",
                          color: scheduleMode === mode ? "var(--text-primary)" : "var(--text-muted)",
                        }}
                      >
                        {mode}
                      </Button>
                    ))}
                  </div>

                  {scheduleMode === "raw" ? (
                    <textarea
                      value={rawRrule}
                      onChange={(event) => setRawRrule(event.target.value)}
                      rows={3}
                      placeholder="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0"
                      className={monoTextareaClass}
                    />
                  ) : (
                    <div className="automation-create-dialog__schedule-body">
                      {scheduleMode === "weekly" && (
                        <div className="automation-create-dialog__day-row">
                          {RRULE_DAY_ORDER.map((day) => {
                            const active = days.includes(day);
                            return (
                              <Button
                                key={day}
                                variant="ghost"
                                size="xs"
                                onClick={() => toggleDay(day)}
                                className="rounded-[var(--radius-control)] border px-2 py-1 text-[length:var(--text-xs)] transition-colors"
                                style={{
                                  background: active ? "color-mix(in oklch, var(--accent-presence) 18%, transparent)" : "var(--bg-base)",
                                  borderColor: active ? "color-mix(in oklch, var(--accent-presence) 50%, transparent)" : "var(--border-hairline)",
                                  color: active ? "var(--text-primary)" : "var(--text-muted)",
                                }}
                              >
                                {RRULE_DAY_LABEL[day]}
                              </Button>
                            );
                          })}
                        </div>
                      )}
                      <input
                        type="time"
                        value={time}
                        onChange={(event) => setTime(event.target.value)}
                        className={inputClass}
                      />
                    </div>
                  )}

                  {/* The plan the user can actually check, above the machine
                      form. The spec keeps the RRULE echo for experts but files
                      its being the ONLY readout as a P1 — "raw RRULE exposed
                      with no plain-English translation". */}
                  <SchedulePlanPreview plan={plan} ariaLabel="Cron schedule plan" />

                  {/* Safe by default: a new routine runs nothing until it is
                      resumed, and resuming is its own revision-checked step. */}
                  <fieldset className="workflow-field automation-create-dialog__field">
                    <legend>After creating</legend>
                    <label className="flex items-start gap-2 text-[length:var(--text-sm)]">
                      <input type="radio" name="automation-start" value="paused" checked={start === "paused"} onChange={() => setStart("paused")} />
                      <span>Keep it paused. Nothing runs until you resume it.</span>
                    </label>
                    <label className="flex items-start gap-2 text-[length:var(--text-sm)]">
                      <input type="radio" name="automation-start" value="active" checked={start === "active"} onChange={() => setStart("active")} />
                      <span>Review activation after creation. It stays paused until you confirm.</span>
                    </label>
                  </fieldset>

                  <p
                    className="automation-create-dialog__rrule"
                    style={{ color: validSchedule ? "var(--text-muted)" : "oklch(0.7 0.16 35)" }}
                  >
                    {rrule || "RRULE required"}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="automation-create-dialog__section" aria-label="Prompt">
            <div className="automation-create-dialog__section-header">
              <h3>Prompt</h3>
            </div>
            <div className="automation-create-dialog__prompt-grid">
              <label className="workflow-field automation-create-dialog__field">
                <span>Goals</span>
                <textarea
                  value={goals}
                  onChange={(event) => setGoals(event.target.value)}
                  rows={4}
                  placeholder="What should this automation accomplish?"
                  className={`workflow-run-input-field ${textareaClass}`}
                />
              </label>

              <label className="workflow-field automation-create-dialog__field">
                <span>Deliverables</span>
                <textarea
                  value={deliverables}
                  onChange={(event) => setDeliverables(event.target.value)}
                  rows={4}
                  placeholder="Expected outputs (optional)"
                  className={`workflow-run-input-field ${textareaClass}`}
                />
              </label>
            </div>
          </section>

          <section className="automation-create-dialog__section" aria-label="Runtime">
            <div className="automation-create-dialog__section-header">
              <h3>Runtime</h3>
            </div>
            <div className="automation-create-dialog__runtime-grid">
              <div className="workflow-field automation-create-dialog__field automation-create-dialog__field--wide">
                <span>Familiar</span>
                <p id={familiarHelpId} className="text-[length:var(--text-xs)] [color:var(--text-secondary)]!">Choose exactly one familiar. Reasoning, environment and skill overrides are unavailable.</p>
                <StandardSelect
                  label="Familiar"
                  aria-describedby={familiarHelpId}
                  value={selected}
                  onChange={setSelected}
                  options={[{ value: "", label: "Choose a familiar" }, ...resolvedFamiliars.map(familiar => ({ value: familiar.id, label: familiar.display_name }))]}
                  className={inputClass}
                />
              </div>

              <label className="workflow-field automation-create-dialog__field automation-create-dialog__field--wide">
                <span>Model</span>
                <input
                  type="text"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="e.g. claude-sonnet-4-5 (leave blank for default)"
                  className={inputClass}
                />
              </label>




            </div>
          </section>

          <section className="automation-create-dialog__section" aria-label="Scope">
            <div className="automation-create-dialog__section-header">
              <h3>Scope</h3>
            </div>
            <div className="automation-create-dialog__scope-grid">
              <label className="workflow-field automation-create-dialog__field automation-create-dialog__field--wide">
                <span>Working directory · Optional</span>
                <CwdPickerField
                  value={cwds}
                  onChange={setCwds}
                  familiarId={selected}
                  textareaClass={monoTextareaClass}
                />
              </label>

              <label className="workflow-field automation-create-dialog__field">
                <span>Tags</span>
                <input
                  type="text"
                  value={tagsText}
                  onChange={(event) => setTagsText(event.target.value)}
                  placeholder="coven, nightly (comma-separated)"
                  className={inputClass}
                />
              </label>


            </div>
          </section>
        </div>

        {error && <p role="alert" className="text-[length:var(--text-sm)] [color:var(--color-danger)]!">{error}</p>}
        <div className="workflow-dialog-actions automation-create-dialog__footer">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="workflow-primary-button"
            disabled={!canCreate}
            onClick={handleCreate}
            leadingIcon="ph:plus-bold"
          >
            {/* The CTA names its outcome. The spec files a bare "+ Create" as a
                P1 — it never says what it creates — and the plan is already
                computed, so the label costs nothing it does not already know.
                It falls back to plain "Create" rather than inventing a summary
                when there is no readable plan to name. */}
            {busy ? "Creating…" : planLabel ? `Create · ${planLabel}` : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}
