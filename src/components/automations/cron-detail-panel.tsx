"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CwdPickerField } from "@/components/cwd-picker-field";
import { SkillSelect } from "@/components/automation-skill-select";
import { Button } from "@/components/ui/button";
import { StandardSelect } from "@/components/ui/select";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { CodexAutomation, CodexAutomationPatch } from "@/lib/codex-automations-types";
import type { AutomationRunRecord } from "@/lib/automation-runs";
import { formatTimestamp, readDateTimePrefs } from "@/lib/datetime-format";
import { Icon } from "@/lib/icon";
import { RRULE_DAY_LABEL, RRULE_DAY_ORDER, buildCodexRrule, parseCodexRrule, composeAutomationPrompt, splitAutomationPrompt } from "@/lib/codex-automation-form";
import { commaInput, listInput, parseListInput } from "@/lib/automations/list-input";
import { relativeTimeSigned } from "@/lib/relative-time";
import { runStatusColor, runStatusIcon } from "@/lib/automations/run-status";
import { CronDetailSection, CronSummaryTile, FieldLabel } from "@/components/automations/cron-detail-primitives";

const SCHEDULE_MODE_LABEL: Record<"weekly" | "daily" | "raw", string> = {
  weekly: "Weekly",
  daily: "Daily",
  raw: "Advanced",
};
const fieldBaseClass = "w-full rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--border-strong)]";
const inputClass = `${fieldBaseClass} h-8 px-2 text-[length:var(--text-sm)]`;
const selectClass = `${fieldBaseClass} h-8 px-2 text-[length:var(--text-sm)]`;
const textareaClass = `${fieldBaseClass} resize-y px-2 py-2 text-[length:var(--text-sm)] leading-relaxed`;
const monoTextareaClass = `${textareaClass} font-mono text-[length:var(--text-xs)]`;

// Same relative formatting the list rows use (schedule-list.tsx), so a run
// never reads "3d ago" in the list but "Jul 20, 2:15 PM" in this panel.
function relTime(iso: string | undefined | null): string {
  return iso ? relativeTimeSigned(iso) : "—";
}

export function CodexDetailPanel({
  auto,
  busy,
  expanded,
  onToggleExpanded,
  onClose,
  onToggle,
  onSave,
  onDelete,
  onRun,
  runs,
}: {
  auto: CodexAutomation;
  busy: boolean;
  /** Full-page-width mode: the rail grows to fill the surface and the form
   *  reflows into a two-column canvas (list hidden until collapsed). */
  expanded: boolean;
  onToggleExpanded: () => void;
  onClose: () => void;
  onToggle: (auto: CodexAutomation) => void;
  onSave: (auto: CodexAutomation, patch: CodexAutomationPatch) => void;
  onDelete: (auto: CodexAutomation) => void;
  onRun: (auto: CodexAutomation) => void;
  runs: AutomationRunRecord[];
}) {
  const isActive = auto.status === "ACTIVE";
  // Dialog semantics for the cron detail panel — trap focus, Escape closes, focus
  // returns to the opening row. aria-modal omitted (see DetailPanel's note).
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(true, panelRef, { onEscape: onClose });
  const parsedSchedule = useMemo(() => parseCodexRrule(auto.rrule), [auto.rrule]);
  const promptParts = splitAutomationPrompt(auto.prompt);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [runLog, setRunLog] = useState<string>("");
  const [runLogLoading, setRunLogLoading] = useState(false);
  // Rapid run switches: only the latest log request may write state, or a
  // slow earlier response renders the WRONG log under the newer run's header
  // (same stale-response guard as runsReqRef for the runs list).
  const runLogReqRef = useRef(0);
  const toggleRunLog = async (runId: string) => {
    if (openRunId === runId) {
      // Closing also invalidates any in-flight fetch for this run's log.
      runLogReqRef.current += 1;
      setOpenRunId(null);
      return;
    }
    const req = ++runLogReqRef.current;
    setOpenRunId(runId);
    setRunLog("");
    setRunLogLoading(true);
    try {
      const res = await fetch(`/api/codex-automations/${encodeURIComponent(auto.id)}/runs/${encodeURIComponent(runId)}/log`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (req !== runLogReqRef.current) return;
      setRunLog(json?.ok ? (json.truncated ? "…(truncated)…\n" : "") + (json.log ?? "") : (json?.error ?? "no log"));
    } catch {
      if (req !== runLogReqRef.current) return;
      setRunLog("failed to load log");
    } finally {
      if (req === runLogReqRef.current) setRunLogLoading(false);
    }
  };
  const [name, setName] = useState(auto.name);
  const [goals, setGoals] = useState(promptParts.goals);
  const [deliverables, setDeliverables] = useState(promptParts.deliverables);
  const [model, setModel] = useState(auto.model ?? "");
  const [reasoningEffort, setReasoningEffort] = useState(auto.reasoningEffort ?? "medium");
  const [executionEnvironment, setExecutionEnvironment] = useState(auto.executionEnvironment ?? "worktree");
  const [tagsText, setTagsText] = useState(commaInput(auto.tags));
  const [cwdsText, setCwdsText] = useState(listInput(auto.cwds));
  const [skillPath, setSkillPath] = useState(auto.skillPath ?? "");
  const [scheduleMode, setScheduleMode] = useState<"daily" | "weekly" | "raw">(parsedSchedule.mode);
  const [scheduleTime, setScheduleTime] = useState(parsedSchedule.time);
  const [scheduleDays, setScheduleDays] = useState(parsedSchedule.days);
  const [rawRrule, setRawRrule] = useState(parsedSchedule.raw);

  useEffect(() => {
    const nextSchedule = parseCodexRrule(auto.rrule);
    const nextPromptParts = splitAutomationPrompt(auto.prompt);
    setName(auto.name);
    setGoals(nextPromptParts.goals);
    setDeliverables(nextPromptParts.deliverables);
    setModel(auto.model ?? "");
    setReasoningEffort(auto.reasoningEffort ?? "medium");
    setExecutionEnvironment(auto.executionEnvironment ?? "worktree");
    setTagsText(commaInput(auto.tags));
    setCwdsText(listInput(auto.cwds));
    setSkillPath(auto.skillPath ?? "");
    setScheduleMode(nextSchedule.mode);
    setScheduleTime(nextSchedule.time);
    setScheduleDays(nextSchedule.days);
    setRawRrule(nextSchedule.raw);
  }, [auto]);

  const nextRrule = buildCodexRrule(scheduleMode, scheduleTime, scheduleDays, rawRrule);
  const tags = parseListInput(tagsText);
  const cwds = parseListInput(cwdsText);
  const promptDirty = goals !== promptParts.goals || deliverables !== promptParts.deliverables;
  const nextPrompt = promptDirty
    ? composeAutomationPrompt(goals, deliverables, promptParts.hasStructuredSections || deliverables.trim().length > 0)
    : auto.prompt;
  const invalidSchedule =
    !nextRrule.startsWith("RRULE:") || (scheduleMode === "weekly" && scheduleDays.length === 0);
  const dirty =
    name !== auto.name ||
    promptDirty ||
    model !== (auto.model ?? "") ||
    reasoningEffort !== (auto.reasoningEffort ?? "medium") ||
    executionEnvironment !== (auto.executionEnvironment ?? "worktree") ||
    tagsText !== commaInput(auto.tags) ||
    cwdsText !== listInput(auto.cwds) ||
    skillPath.trim() !== (auto.skillPath ?? "") ||
    nextRrule !== (auto.rrule ?? "");
  const canSave = !busy && dirty && name.trim().length > 0 && !invalidSchedule;

  // When Save is disabled because the form is invalid (not merely unchanged),
  // explain why instead of leaving the user with a dead button.
  const saveBlockedReason =
    name.trim().length === 0
      ? "Give the automation a name."
      : scheduleMode === "weekly" && scheduleDays.length === 0
        ? "Pick at least one day for a weekly schedule."
        : !nextRrule.startsWith("RRULE:")
          ? "Enter a valid schedule."
          : null;

  const toggleDay = (day: string) => {
    setScheduleDays((prev) =>
      prev.includes(day) ? prev.filter((item) => item !== day) : [...prev, day],
    );
  };

  const save = () => {
    if (!canSave) return;
    onSave(auto, {
      name: name.trim(),
      prompt: nextPrompt,
      rrule: nextRrule,
      model: model.trim(),
      reasoning_effort: reasoningEffort,
      execution_environment: executionEnvironment,
      tags,
      cwds,
      // Send "" (not undefined) so selecting "— none —" actually clears the skill.
      skill_path: skillPath.trim(),
    });
  };
  const latestRun = runs[0];
  const latestRunLabel = latestRun
    ? `${latestRun.status} ${relTime(latestRun.startedAt)}`
    : "No runs yet";


  // Each section is built once; the layout arranges them per mode. The rail
  // stacks them in priority order (identity, instructions, schedule, runtime),
  // while the expanded canvas pairs them into two independent column stacks so
  // a short section never leaves a row-aligned hole beside a tall one.
  const identitySection = (
    <CronDetailSection title="Identity" description="Name and labels used to recognize this cron in Rituals.">
      <div>
        <FieldLabel htmlFor={`cron-name-${auto.id}`}>Name</FieldLabel>
        <input
          id={`cron-name-${auto.id}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 @min-[640px]:grid-cols-2">
        <div>
          <FieldLabel htmlFor={`cron-tags-${auto.id}`}>Tags</FieldLabel>
          <input
            id={`cron-tags-${auto.id}`}
            value={tagsText}
            onChange={(event) => setTagsText(event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <FieldLabel>Skill</FieldLabel>
          <SkillSelect value={skillPath || null} onChange={(p) => setSkillPath(p ?? "")} className={selectClass} />
        </div>
      </div>
    </CronDetailSection>
  );
  const instructionsSection = (
    <CronDetailSection title="Instructions" description="What the cron should do and what output it should leave behind.">
      <div>
        <FieldLabel htmlFor={`cron-goals-${auto.id}`}>Goals</FieldLabel>
        <textarea
          id={`cron-goals-${auto.id}`}
          value={goals}
          onChange={(event) => setGoals(event.target.value)}
          rows={5}
          className={textareaClass}
        />
      </div>
      <div>
        <FieldLabel htmlFor={`cron-deliverables-${auto.id}`}>Deliverables</FieldLabel>
        <textarea
          id={`cron-deliverables-${auto.id}`}
          value={deliverables}
          onChange={(event) => setDeliverables(event.target.value)}
          rows={4}
          className={textareaClass}
        />
      </div>
    </CronDetailSection>
  );
  const scheduleSection = (
    <CronDetailSection title="Schedule" description="Choose the cadence first; use raw RRULE only when the presets are too narrow.">
      <div className="inline-flex rounded-[var(--radius-control)] border p-0.5 [border-color:var(--border-hairline)]! [background:var(--bg-base)]!"
        role="group"
        aria-label="Schedule mode"
      >
        {(["weekly", "daily", "raw"] as const).map((mode) => (
          <Button
            key={mode}
            variant="ghost"
            size="xs"
            onClick={() => setScheduleMode(mode)}
            aria-pressed={scheduleMode === mode}
            className="rounded-[var(--radius-control)] px-2 py-1 text-[length:var(--text-xs)]"
            style={{
              background: scheduleMode === mode ? "color-mix(in oklch, var(--foreground) 8%, transparent)" : "transparent",
              color: scheduleMode === mode ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {SCHEDULE_MODE_LABEL[mode]}
          </Button>
        ))}
      </div>

      {scheduleMode === "raw" ? (
        <textarea
          aria-label="Raw RRULE"
          value={rawRrule}
          onChange={(event) => setRawRrule(event.target.value)}
          rows={3}
          className={monoTextareaClass}
        />
      ) : (
        <div className="space-y-3">
          {scheduleMode === "weekly" && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days of week">
              {RRULE_DAY_ORDER.map((day) => {
                const selected = scheduleDays.includes(day);
                return (
                  <Button
                    key={day}
                    variant="ghost"
                    size="xs"
                    onClick={() => toggleDay(day)}
                    aria-pressed={selected}
                    className="rounded-[var(--radius-control)] border px-2 py-1 text-[length:var(--text-xs)]"
                    style={{
                      background: selected ? "color-mix(in oklch, var(--accent-presence) 18%, transparent)" : "var(--bg-base)",
                      borderColor: selected ? "color-mix(in oklch, var(--accent-presence) 50%, transparent)" : "var(--border-hairline)",
                      color: selected ? "var(--text-primary)" : "var(--text-muted)",
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
            aria-label="Schedule time"
            value={scheduleTime}
            onChange={(event) => setScheduleTime(event.target.value)}
            className={inputClass}
          />
        </div>
      )}
      {/* Plain-language echo of the chosen cadence for preset modes; the
          cryptic RRULE line only surfaces in Advanced mode or when the
          schedule is invalid — beginners never have to read iCalendar. */}
      {scheduleMode !== "raw" && !invalidSchedule ? (
        <p className="mt-2 text-[length:var(--text-xs)] [color:var(--text-muted)]!">
          {scheduleMode === "daily"
            ? `Runs every day at ${scheduleTime}`
            : `Runs weekly on ${RRULE_DAY_ORDER.filter((d) => scheduleDays.includes(d)).map((d) => RRULE_DAY_LABEL[d]).join(", ")} at ${scheduleTime}`}
        </p>
      ) : (
        <p className="mt-2 break-all font-mono text-[length:var(--text-2xs)]" style={{ color: invalidSchedule ? "var(--color-warning)" : "var(--text-muted)" }}>
          {nextRrule || "RRULE required"}
        </p>
      )}
    </CronDetailSection>
  );
  const runtimeSection = (
    <CronDetailSection title="Runtime" description="Where the cron runs and which model settings it should use.">
      <div className="grid grid-cols-1 gap-3 @min-[640px]:grid-cols-2">
        <div>
          <FieldLabel htmlFor={`cron-model-${auto.id}`}>Model</FieldLabel>
          <input
            id={`cron-model-${auto.id}`}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <FieldLabel>Reasoning</FieldLabel>
          <StandardSelect
            label="Reasoning"
            value={reasoningEffort}
            onChange={setReasoningEffort}
            className={selectClass}
            options={[
              ...(!["low", "medium", "high"].includes(reasoningEffort)
                ? [{ value: reasoningEffort, label: reasoningEffort }]
                : []),
              { value: "low", label: "low" },
              { value: "medium", label: "medium" },
              { value: "high", label: "high" },
            ]}
          />
        </div>
        <div>
          <FieldLabel>Environment</FieldLabel>
          <StandardSelect
            label="Environment"
            value={executionEnvironment}
            onChange={setExecutionEnvironment}
            className={selectClass}
            options={[
              ...(!["worktree", "repo"].includes(executionEnvironment)
                ? [{ value: executionEnvironment, label: executionEnvironment }]
                : []),
              { value: "worktree", label: "worktree" },
              { value: "repo", label: "repo" },
            ]}
          />
        </div>
      </div>
      <div>
        <FieldLabel>Working directories</FieldLabel>
        <CwdPickerField
          value={cwdsText}
          onChange={setCwdsText}
          familiarId={auto.familiars[0] ?? ""}
          textareaClass={monoTextareaClass}
        />
      </div>
    </CronDetailSection>
  );
  const runsSection = runs.length > 0 ? (
    <CronDetailSection title="Recent runs" description="Open a run to inspect its log without leaving this cron.">
      <ul className="mt-1 space-y-1">
        {runs.slice(0, 10).map((r) => (
          <li key={r.id}>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void toggleRunLog(r.id)}
              aria-expanded={openRunId === r.id}
              aria-controls={`automation-run-log-${r.id}`}
              aria-label={`${r.status} run ${relTime(r.startedAt)}${r.summary ? ` — ${r.summary}` : ""}, ${openRunId === r.id ? "hide" : "show"} log`}
              className="w-full justify-start rounded-[var(--radius-control)] px-2 py-1 text-left text-[length:var(--text-sm)] hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]"
            >
              {/* Shape + color (WCAG 1.4.1): the icon form carries the
                  status for color-blind users; AT reads it from the
                  button's aria-label. */}
              <span aria-hidden className="shrink-0" style={{ color: runStatusColor(r.status), lineHeight: 0 }}>
                <Icon name={runStatusIcon(r.status)} width={12} />
              </span>
              <span className="[color:var(--text-secondary)]!" title={r.startedAt ? formatTimestamp(r.startedAt, readDateTimePrefs()) : undefined}>{relTime(r.startedAt)}</span>
              {r.summary && <span className="truncate [color:var(--text-muted)]!">{r.summary}</span>}
              <span aria-hidden className="ml-auto shrink-0 [color:var(--text-muted)]! [line-height:0]!">
                <Icon name={openRunId === r.id ? "ph:caret-down" : "ph:caret-right"} width={11} />
              </span>
            </Button>
            {openRunId === r.id && (
              <pre
                id={`automation-run-log-${r.id}`}
                className="mt-1 max-h-48 overflow-auto rounded-[var(--radius-control)] bg-[var(--bg-base)] p-2 text-[length:var(--text-2xs)] leading-snug [color:var(--text-muted)]! [white-space:pre-wrap]! [word-break:break-word]!"
              >
                {runLogLoading ? "Loading…" : (runLog || "(empty log)")}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </CronDetailSection>
  ) : null;

  return (
    <div ref={panelRef} role="dialog" aria-labelledby={titleId} tabIndex={-1}
      className="flex h-full flex-col focus:outline-none [background:var(--bg-raised)]! [border-left:1px_solid_var(--border-hairline)]!">
      <div className="border-b px-5 py-4 [border-color:var(--border-hairline)]!">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[length:var(--text-2xs)] font-semibold uppercase tracking-widest [color:var(--text-muted)]!">
              Cron details
            </p>
            <h2 id={titleId} className="mt-1 truncate text-[length:var(--text-md)] font-semibold [color:var(--text-primary)]!">
              {name.trim() || auto.name}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-2 py-1 text-[length:var(--text-xs)] font-medium"
              style={{
                borderColor: isActive ? "color-mix(in oklch, var(--accent-presence) 45%, transparent)" : "var(--border-hairline)",
                background: isActive ? "color-mix(in oklch, var(--accent-presence) 14%, transparent)" : "var(--bg-base)",
                color: isActive ? "var(--color-success)" : "var(--text-muted)",
              }}
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: isActive ? "var(--color-success)" : "var(--text-muted)" }} />
              {isActive ? "Active" : "Paused"}
            </span>
            <Button
              variant="ghost"
              size="xs"
              onClick={onToggleExpanded}
              aria-pressed={expanded}
              aria-label={expanded ? "Collapse to side panel" : "Expand to full width"}
              title={expanded ? "Collapse to side panel" : "Expand to full width"}
              className="cron-detail-expand-toggle rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]"
              leadingIcon={expanded ? "ph:arrows-in-simple" : "ph:arrows-out-simple"}
            />
            <Button
              variant="ghost"
              size="xs"
              onClick={onClose}
              aria-label="Close"
              className="rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]"
              leadingIcon="ph:x"
            />
          </div>
        </div>
      </div>

      {/* Merge of main's expanded variant with the split-fit container: columns
          key off the pane, not the viewport (cave-hivd). */}
      <div className={`@container flex-1 overflow-y-auto py-5 ${expanded ? "px-6 md:px-8" : "px-5"}`}>
        <div className={`space-y-5${expanded ? " mx-auto w-full max-w-6xl" : ""}`}>
        <div className={`cron-detail-summary-grid grid grid-cols-2 gap-2${expanded ? " @min-[900px]:grid-cols-4" : ""}`}>
          <CronSummaryTile label="Schedule" value={auto.scheduleHuman || nextRrule || "Not scheduled"} tone={invalidSchedule ? "danger" : "default"} />
          <CronSummaryTile label="Status" value={isActive ? "Active" : "Paused"} tone={isActive ? "active" : "paused"} />
          <CronSummaryTile label="Model" value={model.trim() || "Default"} />
          <CronSummaryTile label="Last run" value={latestRunLabel} tone={latestRun?.status === "failed" ? "danger" : "default"} />
        </div>

        {expanded ? (
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <div className="min-w-0 space-y-5">
              {identitySection}
              {scheduleSection}
            </div>
            <div className="min-w-0 space-y-5">
              {instructionsSection}
              {runtimeSection}
            </div>
            {runsSection && <div className="min-w-0 lg:col-span-2">{runsSection}</div>}
          </div>
        ) : (
          <div className="space-y-5">
            {identitySection}
            {instructionsSection}
            {scheduleSection}
            {runtimeSection}
            {runsSection}
          </div>
        )}
        </div>
      </div>

      <div className="cron-detail-actions border-t px-5 py-4 [border-color:var(--border-hairline)]!">
        <div className={`space-y-3${expanded ? " mx-auto w-full max-w-xl" : ""}`}>
        {saveBlockedReason ? (
          <p className="text-[length:var(--text-xs)] [color:var(--color-warning)]!" role="alert">
            {saveBlockedReason}
          </p>
        ) : null}
        <Button
          variant="primary"
          fullWidth
          disabled={!canSave}
          onClick={save}
          className="justify-center rounded-[var(--radius-control)] py-2 text-[length:var(--text-sm)] font-medium transition-colors disabled:opacity-40"
          leadingIcon="ph:floppy-disk-bold"
        >
          {busy ? "Saving..." : "Save changes"}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => onRun(auto)}
            className="justify-center rounded-[var(--radius-control)] text-[length:var(--text-sm)] font-medium"
            leadingIcon="ph:play"
          >
            Run now
          </Button>
          <Button
            variant={isActive ? "danger" : "secondary"}
            disabled={busy}
            onClick={() => onToggle(auto)}
            className="justify-center rounded-[var(--radius-control)] text-[length:var(--text-sm)] font-medium"
            leadingIcon={isActive ? "ph:pause" : "ph:play"}
          >
            {busy ? (isActive ? "Pausing…" : "Activating…") : (isActive ? "Pause" : "Activate")}
          </Button>
        </div>
        <div className="border-t pt-3 [border-color:var(--border-hairline)]!">
          <Button
            variant="danger-ghost"
            disabled={busy}
            onClick={() => onDelete(auto)}
            className="rounded-[var(--radius-control)] text-[length:var(--text-sm)] font-medium"
            leadingIcon="ph:trash"
          >
            Delete
          </Button>
        </div>
        </div>
      </div>
    </div>
  );
}
