"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useAnnouncer } from "@/components/ui/live-region";
import { SearchInput } from "@/components/ui/search-input";
import { StandardSelect } from "@/components/ui/select";
import { TextArea } from "@/components/ui/text-area";
import { TextInput } from "@/components/ui/text-input";
import { publishBoardChanged } from "@/lib/board-cache-events";
import type { Card, TaskDependency, TaskDependencyKind, TaskNextStep } from "@/lib/cave-board-types";
import { orchestrationFingerprint } from "@/lib/task-dependency-review";
import {
  changeDraftDependencies,
  changeDraftNextStep,
  orchestrationDraft,
  type OrchestrationDraft,
} from "@/lib/task-orchestration-editor";
import { useLatestAsyncData } from "@/lib/use-role-surfaces";
import "@/styles/task-orchestration-editor.css";

type FamiliarOption = { id: string; name: string };

const dependencyKinds: { value: TaskDependencyKind; label: string }[] = [
  { value: "task", label: "Task" },
  { value: "github", label: "GitHub" },
  { value: "human", label: "Human decision" },
  { value: "credential", label: "Credential" },
  { value: "service", label: "Service" },
  { value: "execution", label: "Execution" },
  { value: "external", label: "External condition" },
];

function editorSnapshot(card: Card): string {
  return JSON.stringify([orchestrationFingerprint(card), card.dependencyReview?.reviewedAt ?? null]);
}

async function fetchTasks(): Promise<Card[]> {
  const response = await fetch("/api/board", { cache: "no-store" });
  const body = await response.json();
  if (
    !response.ok || body?.ok !== true || !Array.isArray(body.cards) ||
    !body.cards.every((card: Partial<Card> | null) =>
      card && typeof card.id === "string" && typeof card.title === "string")
  ) {
    throw new Error("Couldn't load tasks. Retry to load prerequisites and downstream tasks.");
  }
  return body.cards;
}

export type TaskOrchestrationFieldsProps = {
  value: OrchestrationDraft;
  onChange: (draft: OrchestrationDraft) => void;
  cardId?: string;
  cards?: readonly Card[];
  familiars: readonly FamiliarOption[];
  disabled?: boolean;
};

export function TaskOrchestrationFields({
  value,
  onChange,
  cardId,
  cards,
  familiars,
  disabled = false,
}: TaskOrchestrationFieldsProps) {
  const id = useId();
  const { announce } = useAnnouncer();
  const [query, setQuery] = useState("");
  const [newKind, setNewKind] = useState<TaskDependencyKind>("external");
  const addButton = useRef<HTMLButtonElement>(null);
  const { data, error, reload } = useLatestAsyncData<Card[]>({
    scopeKey: "task-orchestration-prerequisites",
    load: fetchTasks,
    errorMessage: "Couldn't load tasks. Retry to load prerequisites and downstream tasks.",
    enabled: cards === undefined,
  });
  const available = cards ?? data;
  const loadError = cards === undefined ? error : null;
  const unresolved = value.dependencies.filter((dependency) => dependency.state === "unresolved");
  const chosenTasks = new Set(
    value.dependencies.filter((dependency) => dependency.kind === "task").map((dependency) => dependency.taskId),
  );
  const matchingTasks = available?.filter((task) =>
    task.id !== cardId && `${task.title} ${task.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const downstream = available?.filter((task) =>
    task.id !== cardId && task.dependencies?.some((dependency) =>
      dependency.kind === "task" && dependency.taskId === cardId));

  function change(patch: Partial<OrchestrationDraft>) {
    if (disabled) return;
    onChange({ ...value, ...patch, dependencyReviewAction: undefined });
  }

  function setDependencies(dependencies: TaskDependency[]) {
    if (disabled) return;
    onChange(changeDraftDependencies(value, dependencies));
  }

  function addDependency(kind: TaskDependencyKind, task?: Card) {
    setDependencies([...value.dependencies, {
      id: crypto.randomUUID(),
      kind,
      label: task ? `Complete ${task.title}` : "",
      ...(task ? { taskId: task.id } : { ref: "" }),
      state: "unresolved",
      origin: "human",
      createdAt: new Date().toISOString(),
    }]);
    announce(task ? `Added prerequisite “${task.title}”.` : "Added dependency. Enter its label and stable reference.");
  }

  function editDependency(dependency: TaskDependency, patch: Partial<TaskDependency>) {
    setDependencies(value.dependencies.map((entry) =>
      entry.id === dependency.id ? { ...entry, ...patch, origin: "human" } : entry));
  }

  function removeDependency(dependencyId: string) {
    setDependencies(value.dependencies.filter((dependency) => dependency.id !== dependencyId));
    addButton.current?.focus();
    announce("Removed dependency.");
  }

  function moveDependency(index: number, direction: -1 | 1) {
    const dependencies = [...value.dependencies];
    const next = index + direction;
    [dependencies[index], dependencies[next]] = [dependencies[next], dependencies[index]];
    setDependencies(dependencies);
    announce(`Dependency moved to priority ${next + 1}.`);
  }

  function changeStep(patch: Partial<TaskNextStep>) {
    if (disabled) return;
    onChange(changeDraftNextStep(value, patch, new Date().toISOString()));
  }

  return (
    <fieldset className="task-orchestration-fields" disabled={disabled}>
      <legend>Dependencies and next step</legend>
      <p className="task-orchestration-hint" id={`${id}-direction`}>
        This task waits on the prerequisites below. Their order is priority order.
        Downstream tasks wait on this task and are read-only here.
      </p>
      <Field id={`${id}-search`} label="Task prerequisites" description="Select every task that must finish first.">
        <SearchInput
          id={`${id}-search`}
          className="focus-ring"
          value={query}
          onValueChange={setQuery}
          placeholder="Search tasks…"
          aria-describedby={`${id}-direction ${id}-search-description`}
          disabled={disabled}
        />
      </Field>
      {loadError ? (
        <div role="alert" className="task-orchestration-error">
          <p>{loadError}</p>
          <Button size="sm" className="focus-ring" disabled={disabled} onClick={() => void reload()}>Retry</Button>
        </div>
      ) : available === null ? (
        <p role="status" className="task-orchestration-hint">Loading tasks…</p>
      ) : (
        <div className="task-orchestration-picker" role="group" aria-label="Tasks this task waits on">
          {matchingTasks?.length ? matchingTasks.map((task) => (
            <div key={task.id} className="task-orchestration-check">
              <input
                id={`${id}-task-${task.id}`}
                type="checkbox"
                className="focus-ring"
                checked={chosenTasks.has(task.id)}
                onChange={(event) => {
                  if (event.target.checked) addDependency("task", task);
                  else {
                    setDependencies(value.dependencies.filter((dependency) =>
                      dependency.kind !== "task" || dependency.taskId !== task.id));
                    announce(`Removed prerequisite “${task.title}”.`);
                  }
                }}
              />
              <label htmlFor={`${id}-task-${task.id}`}>
                {task.title} <span className="task-orchestration-hint">({task.status})</span>
              </label>
            </div>
          )) : (
            <p className="task-orchestration-hint" role="status">
              {query ? "No matching tasks. Change the search to find a prerequisite." : "No other tasks yet. Add a task or an external dependency."}
            </p>
          )}
        </div>
      )}
      <div className="task-orchestration-actions">
        <Field id={`${id}-new-kind`} label="Dependency kind">
          <StandardSelect
            id={`${id}-new-kind`}
            label="Dependency kind"
            value={newKind}
            onChange={setNewKind}
            options={dependencyKinds.filter((kind) => kind.value !== "task")}
            disabled={disabled}
          />
        </Field>
        <Button ref={addButton} size="sm" className="focus-ring" disabled={disabled} onClick={() => addDependency(newKind)}>
          Add dependency
        </Button>
      </div>
      {value.dependencies.length === 0 ? (
        <p className="task-orchestration-hint">No prerequisites selected. Add any conditions that must hold before this task can start.</p>
      ) : (
        <ol className="task-orchestration-dependencies">
          {value.dependencies.map((dependency, index) => {
            const depId = `${id}-dependency-${dependency.id}`;
            const referenceOptions = (available ?? []).filter((task) =>
              task.id !== cardId && (task.id === dependency.taskId || !chosenTasks.has(task.id)));
            return (
              <li key={dependency.id} className="task-orchestration-dependency">
                <div className="task-orchestration-row">
                  <strong>Prerequisite {index + 1}</strong>
                  <span>{dependency.state}</span>
                </div>
                <div className="task-orchestration-grid">
                  <Field id={`${depId}-kind`} label="Kind">
                    <StandardSelect
                      id={`${depId}-kind`}
                      label={`Prerequisite ${index + 1} kind`}
                      value={dependency.kind}
                      options={dependencyKinds}
                      disabled={disabled}
                      onChange={(kind) => editDependency(dependency, {
                        kind,
                        ...(kind === "task" ? { ref: null } : { taskId: null }),
                      })}
                    />
                  </Field>
                  <Field label="Label" required description="Name the action, such as “Merge the release pull request”.">
                    <TextInput
                      className="focus-ring"
                      value={dependency.label}
                      onChange={(event) => editDependency(dependency, { label: event.target.value })}
                    />
                  </Field>
                  {dependency.kind === "task" ? (
                    <Field id={`${depId}-task`} label="Prerequisite task" description="This task waits on the selected task.">
                      <StandardSelect
                        id={`${depId}-task`}
                        label={`Prerequisite ${index + 1} task`}
                        value={dependency.taskId ?? ""}
                        options={[
                          { value: "", label: "Choose task…", disabled: true },
                          ...(dependency.taskId && !referenceOptions.some((task) => task.id === dependency.taskId)
                            ? [{ value: dependency.taskId, label: dependency.taskId }]
                            : []),
                          ...referenceOptions.map((task) => ({ value: task.id, label: task.title })),
                        ]}
                        disabled={disabled || available === null || !!loadError}
                        aria-describedby={`${depId}-task-description`}
                        onChange={(taskId) => editDependency(dependency, { taskId })}
                      />
                    </Field>
                  ) : (
                    <Field label="Stable reference" required description="Use a traceable identity, such as owner/repository#4201 or svc:tailscale.">
                      <TextInput
                        className="focus-ring"
                        value={dependency.ref ?? ""}
                        onChange={(event) => editDependency(dependency, { ref: event.target.value })}
                      />
                    </Field>
                  )}
                  <Field label="URL" optional>
                    <TextInput
                      className="focus-ring"
                      type="url"
                      value={dependency.url ?? ""}
                      onChange={(event) => editDependency(dependency, { url: event.target.value })}
                    />
                  </Field>
                </div>
                <details className="task-orchestration-details">
                  <summary className="focus-ring">Evidence and resolution</summary>
                  <Field
                    id={`${depId}-evidence`}
                    label="Evidence"
                    required={dependency.state !== "unresolved"}
                    description="Before resolving or waiving, record a merge URL, run ID, decision record, or person's name."
                  >
                    <TextArea
                      className="focus-ring"
                      rows={2}
                      value={dependency.evidence ?? ""}
                      onChange={(event) => editDependency(dependency, { evidence: event.target.value })}
                    />
                  </Field>
                  {dependency.resolvedAt ? (
                    <p className="task-orchestration-hint">
                      {dependency.state === "waived" ? "Waived" : "Resolved"} by {dependency.resolvedBy ?? dependency.origin} at {dependency.resolvedAt}.
                    </p>
                  ) : null}
                  <div className="task-orchestration-actions">
                    {dependency.state === "unresolved" ? (
                      <>
                        <Button
                          size="sm"
                          className="focus-ring"
                          disabled={disabled || !dependency.evidence?.trim()}
                          onClick={() => {
                            editDependency(dependency, { state: "resolved", resolvedAt: new Date().toISOString(), resolvedBy: "human" });
                            document.getElementById(`${depId}-evidence`)?.focus();
                            announce("Resolved dependency.");
                          }}
                        >Resolve dependency</Button>
                        <Button
                          size="sm"
                          className="focus-ring"
                          disabled={disabled || !dependency.evidence?.trim()}
                          onClick={() => {
                            editDependency(dependency, { state: "waived", resolvedAt: new Date().toISOString(), resolvedBy: "human" });
                            document.getElementById(`${depId}-evidence`)?.focus();
                            announce("Waived dependency.");
                          }}
                        >Waive dependency</Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        className="focus-ring"
                        disabled={disabled}
                        onClick={() => {
                          editDependency(dependency, { state: "unresolved", resolvedAt: null, resolvedBy: null });
                          document.getElementById(`${depId}-evidence`)?.focus();
                          announce("Reopened dependency.");
                        }}
                      >Reopen dependency</Button>
                    )}
                  </div>
                </details>
                <div className="task-orchestration-actions">
                  <Button
                    size="xs"
                    className="focus-ring"
                    disabled={disabled || index === 0}
                    aria-label={`Move prerequisite ${index + 1} up`}
                    onClick={() => moveDependency(index, -1)}
                  >Move up</Button>
                  <Button
                    size="xs"
                    className="focus-ring"
                    disabled={disabled || index === value.dependencies.length - 1}
                    aria-label={`Move prerequisite ${index + 1} down`}
                    onClick={() => moveDependency(index, 1)}
                  >Move down</Button>
                  <Button
                    size="xs"
                    variant="danger-ghost"
                    className="focus-ring"
                    disabled={disabled}
                    aria-label={`Remove prerequisite ${index + 1}`}
                    onClick={() => removeDependency(dependency.id)}
                  >Remove dependency</Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <Field id={`${id}-primary`} label="Primary blocker" description="Choose one unresolved prerequisite. The next unresolved prerequisite is promoted when it clears.">
        <StandardSelect
          id={`${id}-primary`}
          label="Primary blocker"
          value={value.primaryBlockerId ?? ""}
          options={[
            { value: "", label: "No unresolved prerequisites", disabled: unresolved.length > 0 },
            ...unresolved.map((dependency) => ({ value: dependency.id, label: dependency.label || "Unlabelled prerequisite" })),
          ]}
          disabled={disabled || unresolved.length === 0}
          aria-describedby={`${id}-primary-description`}
          onChange={(primaryBlockerId) => change({ primaryBlockerId: primaryBlockerId || null })}
        />
      </Field>
      <div className="task-orchestration-check">
        <input
          id={`${id}-pin`}
          className="focus-ring"
          type="checkbox"
          checked={value.primaryBlockerPinned}
          disabled={disabled || !value.primaryBlockerId}
          onChange={(event) => change({ primaryBlockerPinned: event.target.checked })}
        />
        <label htmlFor={`${id}-pin`}>Pin primary blocker</label>
      </div>
      <section className="task-orchestration-next" aria-labelledby={`${id}-next-heading`}>
        <h4 id={`${id}-next-heading`}>Next step</h4>
        <Field
          label="Next step summary"
          optional={!value.nextStep}
          required={value.nextStep !== null}
          description="Write one imperative action. Leave every next-step field blank to remove it."
        >
          <TextInput
            className="focus-ring"
            value={value.nextStep?.summary ?? ""}
            placeholder="e.g., Rerun the failed check"
            onChange={(event) => changeStep({ summary: event.target.value })}
          />
        </Field>
        <div className="task-orchestration-grid">
          <Field id={`${id}-actor`} label="Acting familiar" optional>
            <StandardSelect
              id={`${id}-actor`}
              label="Acting familiar"
              value={value.nextStep?.actorFamiliarId ?? ""}
              options={[
                { value: "", label: "Unassigned" },
                ...(value.nextStep?.actorFamiliarId && !familiars.some((familiar) => familiar.id === value.nextStep?.actorFamiliarId)
                  ? [{ value: value.nextStep.actorFamiliarId, label: value.nextStep.actorFamiliarId }]
                  : []),
                ...familiars.map((familiar) => ({ value: familiar.id, label: familiar.name })),
              ]}
              disabled={disabled}
              onChange={(actorFamiliarId) => changeStep({ actorFamiliarId: actorFamiliarId || null })}
            />
          </Field>
          <Field label="Capability" optional>
            <TextInput
              className="focus-ring"
              value={value.nextStep?.capability ?? ""}
              onChange={(event) => changeStep({ capability: event.target.value })}
            />
          </Field>
          <Field label="Target" optional>
            <TextInput
              className="focus-ring"
              value={value.nextStep?.target ?? ""}
              onChange={(event) => changeStep({ target: event.target.value })}
            />
          </Field>
          <Field label="Inputs" optional description="Enter one input per line.">
            <TextArea
              className="focus-ring"
              rows={3}
              value={value.nextStep?.inputs?.join("\n") ?? ""}
              onChange={(event) => changeStep({ inputs: event.target.value.split("\n") })}
            />
          </Field>
        </div>
        <div className="task-orchestration-check">
          <input
            id={`${id}-approval`}
            className="focus-ring"
            type="checkbox"
            checked={value.nextStep?.requiresApproval ?? false}
            aria-describedby={`${id}-approval-help`}
            onChange={(event) => changeStep({ requiresApproval: event.target.checked })}
          />
          <label htmlFor={`${id}-approval`}>Requires human approval</label>
        </div>
        <p id={`${id}-approval-help`} className="task-orchestration-hint">
          Automation cannot dispatch this next step until a human approves.
        </p>
      </section>
      {cardId ? (
        <details className="task-orchestration-details">
          <summary className="focus-ring">Downstream tasks — tasks waiting on this task</summary>
          {loadError ? (
            <p className="task-orchestration-error">Downstream tasks are unavailable. Retry loading tasks above.</p>
          ) : available === null ? (
            <p role="status" className="task-orchestration-hint">Loading downstream tasks…</p>
          ) : downstream?.length ? (
            <ul>{downstream.map((task) => <li key={task.id}>{task.title} ({task.status})</li>)}</ul>
          ) : (
            <p className="task-orchestration-hint">No downstream tasks. Add this task as a prerequisite on another task to connect them.</p>
          )}
        </details>
      ) : (
        <div className="task-orchestration-check">
          <input
            id={`${id}-review`}
            className="focus-ring"
            type="checkbox"
            checked={value.dependencyReviewAction === "review"}
            onChange={(event) => onChange({
              ...value,
              dependencyReviewAction: event.target.checked ? "review" : undefined,
            })}
          />
          <label htmlFor={`${id}-review`}>Mark dependencies reviewed when creating this task</label>
        </div>
      )}
    </fieldset>
  );
}

export type TaskOrchestrationEditorProps = {
  card: Card;
  cards?: readonly Card[];
  familiars: readonly FamiliarOption[];
  onSaved: (card: Card) => void;
};

export function TaskOrchestrationEditor({ card, cards, familiars, onSaved }: TaskOrchestrationEditorProps) {
  const { announce } = useAnnouncer();
  const [baseline, setBaseline] = useState(card);
  const [draft, setDraft] = useState(() => orchestrationDraft(card));
  const [observedSnapshot, setObservedSnapshot] = useState(() => editorSnapshot(card));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const latestCard = useRef(card);
  latestCard.current = card;
  const incomingSnapshot = editorSnapshot(card);
  const dirty = JSON.stringify(draft) !== JSON.stringify(orchestrationDraft(baseline));

  // Polling may refresh a clean editor, but it must never replace an unsaved draft.
  if (!dirty && !busy && incomingSnapshot !== observedSnapshot) {
    setBaseline(card);
    setDraft(orchestrationDraft(card));
    setObservedSnapshot(incomingSnapshot);
  }

  function acceptCard(saved: Card) {
    setBaseline(saved);
    setDraft(orchestrationDraft(saved));
    setObservedSnapshot(editorSnapshot(latestCard.current));
    setError(null);
  }

  async function save(dependencyReviewAction?: "review" | "unreview") {
    if (busyRef.current) return;
    if (draft.nextStep && !draft.nextStep.summary.trim()) {
      setError("Add a next step summary, or clear every next-step field to remove it. Your draft is preserved.");
      announce("Couldn't save dependencies. Add a next step summary.", "assertive");
      return;
    }
    const expectedOrchestration = orchestrationFingerprint(baseline);
    const payload = { ...draft, dependencyReviewAction, expectedOrchestration };
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/board/${encodeURIComponent(card.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok || body?.ok !== true || body.card?.id !== card.id || typeof body.card?.title !== "string") {
        if (response.status === 409) {
          throw new Error("This task changed elsewhere. Your draft is preserved. Reload latest to discard it and review the current dependencies.");
        }
        const details = Array.isArray(body?.errors)
          ? body.errors.map((entry: { message?: unknown }) => entry?.message).filter((message: unknown) => typeof message === "string").join(" ")
          : "";
        throw new Error(details || (typeof body?.error === "string" ? body.error : "Couldn't save dependencies. Try saving again."));
      }
      acceptCard(body.card);
      publishBoardChanged();
      onSaved(body.card);
      announce(dependencyReviewAction === "review"
        ? "Saved dependencies and marked reviewed."
        : dependencyReviewAction === "unreview"
          ? "Saved dependencies and marked unreviewed."
          : "Saved dependencies.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Couldn't save dependencies. Try saving again.";
      setError(message);
      announce(`Couldn't save dependencies. ${message}`, "assertive");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function reloadLatest() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const tasks = await fetchTasks();
      const latest = tasks.find((task) => task.id === card.id);
      if (!latest) throw new Error("This task is no longer available. Your draft is preserved.");
      acceptCard(latest);
      onSaved(latest);
      announce("Loaded latest dependencies. Replaced the local draft.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't reload dependencies. Your draft is preserved; retry.");
      announce("Couldn't reload dependencies. Your draft is preserved.", "assertive");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="task-orchestration-editor" aria-label="Edit task dependencies" aria-busy={busy}>
      <p className="task-orchestration-hint">
        Saved dependency review: {baseline.dependencyReview?.reviewedAt
          ? `Reviewed${baseline.dependencies?.length ? "" : " — no prerequisites"} at ${baseline.dependencyReview.reviewedAt}.`
          : "Unreviewed."}
        {dirty ? " Unsaved changes." : ""}
      </p>
      {dirty && incomingSnapshot !== editorSnapshot(baseline) ? (
        <p role="status" className="task-orchestration-hint">
          This task changed elsewhere. Your draft has not been replaced.
        </p>
      ) : null}
      <TaskOrchestrationFields value={draft} onChange={setDraft} cardId={card.id} cards={cards} familiars={familiars} disabled={busy} />
      {error ? <p role="alert" className="task-orchestration-error">{error}</p> : null}
      <div className="task-orchestration-actions">
        <Button size="sm" className="focus-ring" disabled={busy} onClick={() => void save()}>Save dependencies</Button>
        <Button size="sm" variant="primary" className="focus-ring" disabled={busy} onClick={() => void save("review")}>Save and mark reviewed</Button>
        <Button size="sm" variant="ghost" className="focus-ring" disabled={busy} onClick={() => void save("unreview")}>Mark unreviewed</Button>
      </div>
      <div>
        <Button size="sm" variant="ghost" className="focus-ring" disabled={busy} onClick={() => void reloadLatest()}>Reload latest</Button>
        <p className="task-orchestration-hint">Reload latest discards unsaved changes and fetches the saved task.</p>
      </div>
    </section>
  );
}
