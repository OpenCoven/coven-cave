"use client";

/**
 * SkillStageCard — the in-thread "which skill, what stage, what came of it"
 * block (design: docs/chat-github-integration.md §5; bead cave-fpqx.11).
 * Rendered per skill name per turn: agent-emitted `<coven:skill>` markers
 * update it in place; `/skill` invocations render the deterministic
 * "invoked" form under the user turn.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { PropertyPill } from "@/components/ui/property-pill";
import { Icon } from "@/lib/icon";
import type { SkillStage, SkillStageUpdate } from "@/lib/skill-blocks";

const STAGE_ORDER: SkillStage[] = ["loaded", "running", "done"];

function stageVisual(stage: SkillStage | "invoked"): { label: string; cls: string } {
  switch (stage) {
    case "done":
      return { label: "done", cls: "text-[var(--color-success)]" };
    case "error":
      return { label: "error", cls: "text-[var(--color-danger)]" };
    case "running":
      return { label: "running", cls: "text-[var(--accent-presence)]" };
    case "loaded":
      return { label: "loaded", cls: "text-[var(--text-secondary)]" };
    case "invoked":
      return { label: "invoked", cls: "text-[var(--text-secondary)]" };
  }
}

export function SkillStageCard({
  name,
  stage,
  note,
  onSelect,
}: {
  name: string;
  stage: SkillStage | "invoked";
  note?: string;
  onSelect?: () => void;
}) {
  const v = stageVisual(stage);
  const content = (
    <>
      <span aria-hidden className="inline-flex shrink-0 text-[var(--accent-presence)]">
        <Icon name="ph:sparkle" width={13} />
      </span>
      <span className="font-medium text-[var(--text-primary)]">{name}</span>
      {stage !== "invoked" ? (
        <span aria-hidden className="flex items-center gap-1">
          {STAGE_ORDER.map((s, i) => {
            const reached =
              stage === "error" ? i === 0 : STAGE_ORDER.indexOf(stage) >= i;
            return (
              <span
                key={s}
                className="inline-block h-1 w-1 rounded-full"
                style={{
                  background: reached ? "var(--accent-presence)" : "var(--border-strong)",
                }}
              />
            );
          })}
        </span>
      ) : null}
      <span className={`${v.cls} shrink-0`}>{v.label}</span>
      {note ? <span className="min-w-0 truncate text-[var(--text-secondary)]" title={note}>{note}</span> : null}
      {onSelect ? (
        <Icon
          name="ph:caret-right"
          width={12}
          className="ml-auto shrink-0 text-[var(--text-muted)]"
          aria-hidden
        />
      ) : null}
    </>
  );

  const className =
    "cave-skill-card flex w-full items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-raised)_78%,transparent)] px-3 py-1.5 text-left text-[length:var(--text-xs)]";

  return onSelect ? (
    <>
      <button
        type="button"
        className={`${className} focus-ring transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]`}
        data-skill-stage={stage}
        aria-label={`Open details for skill ${name}: ${v.label}${note ? ` — ${note}` : ""}`}
        onClick={onSelect}
      >
        {content}
      </button>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        Skill {name}: {v.label}{note ? ` — ${note}` : ""}
      </span>
    </>
  ) : (
    <div
      className={className}
      data-skill-stage={stage}
      role="status"
      aria-label={`Skill ${name}: ${v.label}${note ? ` — ${note}` : ""}`}
    >
      {content}
    </div>
  );
}

export function SkillRunSummary({ skills }: { skills: SkillStageUpdate[] }) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const selected = selectedName
    ? skills.find((skill) => skill.name === selectedName) ?? null
    : null;
  const completed = skills.filter((skill) => skill.stage === "done").length;
  const errors = skills.filter((skill) => skill.stage === "error").length;
  const allDone = completed === skills.length;

  return (
    <>
      <div
        className="mt-2 space-y-1.5"
        role="list"
        aria-label={`${skills.length} ${skills.length === 1 ? "skill" : "skills"} used in this run`}
      >
        {skills.map((skill) => (
          <div key={skill.name} role="listitem">
            <SkillStageCard
              name={skill.name}
              stage={skill.stage}
              note={skill.note}
              onSelect={() => setSelectedName(skill.name)}
            />
          </div>
        ))}
      </div>

      <Modal
        open={selected !== null}
        onClose={() => setSelectedName(null)}
        breadcrumb={["Chat", "Run skills"]}
        wide
        ariaDescribedBy="skill-run-details-description"
        footerPills={
          <>
            <PropertyPill
              icon="ph:sparkle"
              label={`${skills.length} ${skills.length === 1 ? "skill" : "skills"}`}
            />
            <PropertyPill
              icon={
                errors
                  ? "ph:warning-circle"
                  : allDone
                    ? "ph:check-circle"
                    : "ph:circle-notch-bold"
              }
              label={
                errors
                  ? `${errors} ${errors === 1 ? "issue" : "issues"}`
                  : allDone
                    ? `${completed} done`
                    : `${completed} of ${skills.length} done`
              }
              filled
            />
          </>
        }
        footerActions={
          <Button variant="secondary" onClick={() => setSelectedName(null)}>
            Done
          </Button>
        }
      >
        <div className="space-y-4">
          <div>
            <h2 className="text-[length:var(--text-lg)] font-semibold text-[var(--text-primary)]">
              Skills used in this run
            </h2>
            <p
              id="skill-run-details-description"
              className="mt-1 text-[length:var(--text-sm)] leading-relaxed text-[var(--text-secondary)]"
            >
              Each skill shows its latest reported stage and execution detail.
            </p>
          </div>

          <div className="space-y-2" role="list" aria-label="Run skill details">
            {skills.map((skill) => {
              const visual = stageVisual(skill.stage);
              const isSelected = skill.name === selectedName;
              return (
                <article
                  key={skill.name}
                  role="listitem"
                  data-selected={isSelected || undefined}
                  className={`rounded-[var(--radius-card)] border p-3 ${
                    isSelected
                      ? "border-[color-mix(in_oklch,var(--accent-presence)_48%,var(--border-strong))] bg-[color-mix(in_oklch,var(--accent-presence)_10%,var(--bg-raised))]"
                      : "border-[var(--border-hairline)] bg-[var(--bg-raised)]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon
                      name="ph:sparkle"
                      width={14}
                      className="shrink-0 text-[var(--accent-presence)]"
                      aria-hidden
                    />
                    <strong className="min-w-0 flex-1 truncate text-[length:var(--text-base)] text-[var(--text-primary)]">
                      {skill.name}
                    </strong>
                    <span className={`${visual.cls} shrink-0 text-[length:var(--text-xs)]`}>
                      {visual.label}
                    </span>
                  </div>
                  <p className="mt-2 text-[length:var(--text-sm)] leading-relaxed text-[var(--text-secondary)]">
                    {skill.note ?? "No execution detail was reported for this skill."}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </Modal>
    </>
  );
}
