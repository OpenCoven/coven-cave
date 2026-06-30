"use client";

import { useRef, useState } from "react";
import { Icon } from "@/lib/icon";
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

type Props = {
  resolvedFamiliars: ResolvedFamiliar[];
  onClose: () => void;
  onCreate: (input: AutomationCreateInput) => void;
};


const fieldBaseClass =
  "w-full rounded-md border bg-[var(--bg-base)] text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--border-strong)]";
const inputClass = `${fieldBaseClass} h-8 px-2 text-[12px]`;
const selectClass = `${fieldBaseClass} h-8 px-2 text-[12px]`;
const textareaClass = `${fieldBaseClass} resize-y px-2 py-2 text-[12px] leading-relaxed`;
const monoTextareaClass = `${textareaClass} font-mono text-[11px]`;

const fieldStyle = { borderColor: "var(--border-hairline)" } as const;

export function AutomationCreateDialog({ resolvedFamiliars, onClose, onCreate }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, dialogRef, { onEscape: onClose, focusFirst: false });

  const [name, setName] = useState("");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("daily");
  const [time, setTime] = useState("09:00");
  const [days, setDays] = useState<string[]>([]);
  const [rawRrule, setRawRrule] = useState("");
  const [goals, setGoals] = useState("");
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
        className="workflow-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="New automation"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="workflow-panel-heading">
          <div>
            <p className="workflow-eyebrow">New automation</p>
            <h2>Schedule a Codex run</h2>
          </div>
          <button type="button" className="workflow-icon-button" onClick={onClose} aria-label="Close">
            <Icon name="ph:x" width={14} />
          </button>
        </div>

        {/* Name */}
        <label className="workflow-field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            autoFocus
            placeholder="Nightly code review"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        {/* Schedule */}
        <div className="workflow-field">
          <span>Schedule</span>
          <div className="mb-2 inline-flex rounded-md border p-0.5"
            style={{ borderColor: "var(--border-hairline)", background: "var(--bg-base)" }}>
            {(["weekly", "daily", "raw"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setScheduleMode(mode)}
                className="rounded px-2 py-1 text-[11px] capitalize transition-colors"
                style={{
                  background: scheduleMode === mode ? "rgba(255,255,255,0.08)" : "transparent",
                  color: scheduleMode === mode ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                {mode}
              </button>
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
            <div className="space-y-3">
              {scheduleMode === "weekly" && (
                <div className="flex flex-wrap gap-1.5">
                  {RRULE_DAY_ORDER.map((day) => {
                    const active = days.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDay(day)}
                        className="rounded-md border px-2 py-1 text-[11px] transition-colors"
                        style={{
                          background: active ? "color-mix(in oklch, var(--accent-presence) 18%, transparent)" : "var(--bg-base)",
                          borderColor: active ? "color-mix(in oklch, var(--accent-presence) 50%, transparent)" : "var(--border-hairline)",
                          color: active ? "var(--text-primary)" : "var(--text-muted)",
                        }}
                      >
                        {RRULE_DAY_LABEL[day]}
                      </button>
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

          <p className="mt-1 break-all font-mono text-[10px]"
            style={{ color: validSchedule ? "var(--text-muted)" : "oklch(0.7 0.16 35)" }}>
            {rrule || "RRULE required"}
          </p>
        </div>

        {/* Goals */}
        <label className="workflow-field">
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

        {/* Deliverables */}
        <label className="workflow-field">
          <span>Deliverables</span>
          <textarea
            value={deliverables}
            onChange={(event) => setDeliverables(event.target.value)}
            rows={3}
            placeholder="Expected outputs (optional)"
            className={`workflow-run-input-field ${textareaClass}`}
            style={fieldStyle}
          />
        </label>

        {/* Familiars */}
        <div className="workflow-field">
          <span>Familiars</span>
          <FamiliarMultiSelect
            familiars={resolvedFamiliars}
            selected={selected}
            onChange={setSelected}
          />
        </div>

        {/* Model */}
        <label className="workflow-field">
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

        {/* Reasoning effort */}
        <label className="workflow-field">
          <span>Reasoning</span>
          <select
            value={reasoningEffort}
            onChange={(event) => setReasoningEffort(event.target.value)}
            className={selectClass}
            style={fieldStyle}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>

        {/* Execution environment */}
        <label className="workflow-field">
          <span>Environment</span>
          <select
            value={executionEnvironment}
            onChange={(event) => setExecutionEnvironment(event.target.value)}
            className={selectClass}
            style={fieldStyle}
          >
            <option value="worktree">worktree</option>
            <option value="repo">repo</option>
          </select>
        </label>

        {/* Working directories — type paths or browse projects (parity with the
            cron detail editor). */}
        <label className="workflow-field">
          <span>Working directories</span>
          <CwdPickerField
            value={cwds}
            onChange={setCwds}
            familiarId={[...selected][0] ?? ""}
            textareaClass={monoTextareaClass}
            fieldStyle={fieldStyle}
          />
        </label>

        {/* Tags */}
        <label className="workflow-field">
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

        {/* Skill */}
        <label className="workflow-field">
          <span>Skill</span>
          <SkillSelect
            value={skillPath}
            onChange={setSkillPath}
            className={selectClass}
          />
        </label>

        {/* Footer */}
        <div className="workflow-dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="workflow-primary-button"
            disabled={!canCreate}
            onClick={handleCreate}
          >
            <Icon name="ph:plus-bold" width={13} />
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
