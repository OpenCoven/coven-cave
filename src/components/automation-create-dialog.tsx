"use client";

import { useRef, useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import {
  RRULE_DAY_ORDER,
  RRULE_DAY_LABEL,
  buildCodexRrule,
  composeAutomationPrompt,
  type ScheduleMode,
} from "@/lib/codex-automation-form";
import { FamiliarMultiSelect } from "@/components/automation-familiar-select";
import { SkillSelect } from "@/components/automation-skill-select";
import { CwdPickerField } from "@/components/cwd-picker-field";
import { Button } from "@/components/ui/button";
import { StandardSelect } from "@/components/ui/select";
import { parseListInput } from "@/lib/automations/list-input";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

export type AutomationCreateInput = {
  name: string;
  rrule: string;
  prompt: string;
  cwds: string[];
  tags: string[];
  familiars: string[];
  model: string;
  reasoning_effort: string;
  execution_environment: string;
  skill_path: string | null;
};

export type AutomationCreateInitialValues = {
  name?: string;
  scheduleMode?: ScheduleMode;
  time?: string;
  days?: string[];
  rawRrule?: string;
  goals?: string;
};

type Props = {
  resolvedFamiliars: ResolvedFamiliar[];
  onClose: () => void;
  onCreate: (input: AutomationCreateInput) => void;
  /** Pre-fill fields when opening from a template. */
  initialValues?: AutomationCreateInitialValues;
};

const fieldBaseClass =
  "w-full rounded-[var(--radius-control)] border bg-[var(--bg-base)] text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--border-strong)]";
const inputClass = `${fieldBaseClass} h-8 px-2 text-[12px]`;
const selectClass = `${fieldBaseClass} h-8 px-2 text-[12px]`;
const textareaClass = `${fieldBaseClass} resize-y px-2 py-2 text-[12px] leading-relaxed`;
const monoTextareaClass = `${textareaClass} font-mono text-[11px]`;

const fieldStyle = { borderColor: "var(--border-hairline)" } as const;

export function AutomationCreateDialog({ resolvedFamiliars, onClose, onCreate, initialValues }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, dialogRef, { onEscape: onClose, focusFirst: false });

  const [name, setName] = useState(initialValues?.name ?? "");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(initialValues?.scheduleMode ?? "daily");
  const [time, setTime] = useState(initialValues?.time ?? "09:00");
  const [days, setDays] = useState<string[]>(initialValues?.days ?? []);
  const [rawRrule, setRawRrule] = useState(initialValues?.rawRrule ?? "");
  const [goals, setGoals] = useState(initialValues?.goals ?? "");
  const [deliverables, setDeliverables] = useState("");
  const [model, setModel] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState("medium");
  const [executionEnvironment, setExecutionEnvironment] = useState("worktree");
  const [cwds, setCwds] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [skillPath, setSkillPath] = useState<string | null>(null);

  const toggleDay = (day: string) => {
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  };

  const rrule = buildCodexRrule(scheduleMode, time, days, rawRrule);
  const validSchedule =
    scheduleMode === "raw"
      ? rawRrule.trim().startsWith("RRULE:")
      : scheduleMode === "weekly"
        ? days.length > 0
        : true; // daily is always valid

  const canCreate = name.trim().length > 0 && validSchedule;

  const handleCreate = () => {
    if (!canCreate) return;
    const prompt = composeAutomationPrompt(goals, deliverables, true);
    onCreate({
      name: name.trim(),
      rrule,
      prompt,
      cwds: parseListInput(cwds),
      tags: parseListInput(tagsText),
      familiars: [...selected],
      model: model.trim(),
      reasoning_effort: reasoningEffort,
      execution_environment: executionEnvironment,
      skill_path: skillPath,
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
                style={fieldStyle}
              />
            </label>

            <div className="workflow-field automation-create-dialog__field automation-create-dialog__schedule">
              <span>Schedule</span>
              <div className="automation-create-dialog__schedule-card">
                <div
                  className="automation-create-dialog__segment-control"
                  style={{ borderColor: "var(--border-hairline)", background: "var(--bg-base)" }}
                >
                  {(["weekly", "daily", "raw"] as const).map((mode) => (
                    <Button
                      key={mode}
                      variant="ghost"
                      size="xs"
                      onClick={() => setScheduleMode(mode)}
                      className="rounded-[var(--radius-control)] px-2 py-1 text-[11px] capitalize transition-colors"
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
                    style={fieldStyle}
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
                              className="rounded-[var(--radius-control)] border px-2 py-1 text-[11px] transition-colors"
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
                      style={fieldStyle}
                    />
                  </div>
                )}

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
                style={fieldStyle}
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
                style={fieldStyle}
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
              <span>Familiars</span>
              <FamiliarMultiSelect
                familiars={resolvedFamiliars}
                selected={selected}
                onChange={setSelected}
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
                style={fieldStyle}
              />
            </label>

            <label className="workflow-field automation-create-dialog__field">
              <span>Reasoning</span>
              <StandardSelect
                label="Reasoning"
                value={reasoningEffort}
                onChange={setReasoningEffort}
                options={[
                  { value: "low", label: "low" },
                  { value: "medium", label: "medium" },
                  { value: "high", label: "high" },
                ]}
                className={selectClass}
                style={fieldStyle}
              />
            </label>

            <label className="workflow-field automation-create-dialog__field">
              <span>Environment</span>
              <StandardSelect
                label="Environment"
                value={executionEnvironment}
                onChange={setExecutionEnvironment}
                options={[
                  { value: "worktree", label: "worktree" },
                  { value: "repo", label: "repo" },
                ]}
                className={selectClass}
                style={fieldStyle}
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
              <span>Working directories</span>
              <CwdPickerField
                value={cwds}
                onChange={setCwds}
                familiarId={[...selected][0] ?? ""}
                textareaClass={monoTextareaClass}
                fieldStyle={fieldStyle}
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
                style={fieldStyle}
              />
            </label>

            <label className="workflow-field automation-create-dialog__field">
              <span>Skill</span>
              <SkillSelect
                value={skillPath}
                onChange={setSkillPath}
                className={selectClass}
              />
            </label>
          </div>
        </section>

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
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}
