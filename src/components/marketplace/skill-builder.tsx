"use client";

// Skill Builder — the Marketplace "Build" tab. Author a new SKILL.md (name,
// description, tags, instructions) with a live preview of the exact file that
// will be written, and save it into one of the local skill roots the app
// scans (Coven shared / Claude Code / Codex / shared agents). Saving goes
// through POST /api/skills/build (creation-only; duplicates are refused), so
// the new skill shows up in the Skills tab immediately.

import { useCallback, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { StandardSelect } from "@/components/ui/select";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  composeSkillMd,
  MAX_SKILL_DESCRIPTION_CHARS,
  MAX_SKILL_NAME_CHARS,
  SKILL_BUILD_ROOTS,
  slugifySkillName,
  type SkillBuildRootId,
} from "@/lib/skill-build-format";

const ROOT_HELP: Record<SkillBuildRootId, string> = {
  coven: "Shared Coven root — every familiar in your Cave can load it.",
  claude: "Claude Code's user skills — loaded by Claude Code sessions.",
  codex: "Codex's user skills — loaded by Codex sessions.",
  agents: "The cross-agent ~/.agents root shared by Skills-CLI harnesses.",
};

const STARTER_TEMPLATE = `## When to use

Use this skill when <the situation this skill is for>.

## Steps

1. <first step>
2. <second step>
3. <verify the result>

## Verification

- <how the familiar proves the work is done>
`;

const INPUT_CLASS =
  "focus-ring w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--border-strong)]";

type SavedSkill = { slug: string; path: string };

type Props = {
  /** Fired after a successful save so the hub can refresh the Skills list. */
  onSaved?: () => void;
  /** Jumps to the Skills tab (the success panel's "View in Skills"). */
  onViewSkills?: () => void;
};

export function SkillBuilder({ onSaved, onViewSkills }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [root, setRoot] = useState<SkillBuildRootId>("coven");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedSkill | null>(null);
  const { announce } = useAnnouncer();

  const slug = useMemo(() => slugifySkillName(name), [name]);
  const tags = useMemo(
    () => tagsText.split(",").map((tag) => tag.trim()).filter(Boolean),
    [tagsText],
  );
  const rootMeta = SKILL_BUILD_ROOTS.find((entry) => entry.id === root) ?? SKILL_BUILD_ROOTS[0];
  const destination = `${rootMeta.pathHint}/${slug || "<skill-id>"}/SKILL.md`;
  const preview = useMemo(
    () => composeSkillMd({ name: name || "<name>", description: description || "<description>", tags, instructions: instructions || "<instructions>" }),
    [name, description, tags, instructions],
  );
  const ready = Boolean(slug && name.trim() && description.trim() && instructions.trim());

  const reset = useCallback(() => {
    setName("");
    setDescription("");
    setTagsText("");
    setInstructions("");
    setError(null);
    setSaved(null);
  }, []);

  const save = useCallback(async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/skills/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description, instructions, root, tags }),
      });
      const json = (await res.json()) as { ok?: boolean; slug?: string; path?: string; error?: string };
      if (!json.ok || !json.slug || !json.path) throw new Error(json.error ?? `build http ${res.status}`);
      setSaved({ slug: json.slug, path: json.path });
      announce(`Skill ${json.slug} saved`, "polite");
      onSaved?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "skill save failed";
      setError(msg);
      announce(msg, "assertive");
    } finally {
      setSaving(false);
    }
  }, [announce, description, instructions, name, onSaved, ready, root, saving, tags]);

  if (saved) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 @min-[640px]/marketplace:px-7">
        <section
          aria-label="Skill saved"
          className="mx-auto flex max-w-xl flex-col items-start gap-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-panel)] px-5 py-5"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--bg-elevated)]">
            <Icon name="ph:check-circle" width={20} className="text-[var(--text-primary)]" aria-hidden />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Skill saved</h2>
            <p className="mt-1 text-[12px] text-[var(--text-muted)]">
              <code className="font-mono text-[11px] text-[var(--text-secondary)]">{saved.slug}</code> was written to
            </p>
            <p className="mt-0.5 break-all font-mono text-[11px] text-[var(--text-secondary)]">{saved.path}</p>
            <p className="mt-2 text-[12px] text-[var(--text-muted)]">
              Familiars that load this root pick it up on their next session; it is already listed in the Skills tab.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onViewSkills ? (
              <Button variant="primary" size="sm" leadingIcon="ph:sparkle" onClick={onViewSkills}>
                View in Skills
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" leadingIcon="ph:hammer" onClick={reset}>
              Build another skill
            </Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 @min-[640px]/marketplace:px-7">
      <section className="mb-5" aria-labelledby="skill-builder-heading">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Skill authoring</p>
        <h2 id="skill-builder-heading" className="mt-1 text-[16px] font-semibold text-[var(--text-primary)]">
          Build a skill
        </h2>
        <p className="mt-1 max-w-2xl text-[12px] text-[var(--text-muted)]">
          A skill is a reusable SKILL.md procedure your familiars load while they work. Describe when to use it and
          how it works — the file is written straight into a local skill root and appears in the Skills tab.
        </p>
      </section>

      {error ? (
        <p role="alert" className="mb-4 rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[12px] text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 @min-[860px]/marketplace:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <form
          className="flex min-w-0 flex-col gap-4"
          aria-label="New skill"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-[var(--text-primary)]">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_SKILL_NAME_CHARS}
              placeholder="e.g. Release Notes Writer"
              className={INPUT_CLASS}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-[var(--text-primary)]">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={MAX_SKILL_DESCRIPTION_CHARS}
              rows={2}
              placeholder="When should a familiar reach for this skill? Agents pick skills by this line."
              className={`${INPUT_CLASS} resize-y`}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-[var(--text-primary)]">
              Tags <span className="font-normal text-[var(--text-muted)]">(optional, comma-separated)</span>
            </span>
            <input
              type="text"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="e.g. release, notes"
              className={INPUT_CLASS}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-[var(--text-primary)]">Destination</span>
            <StandardSelect
              label="Destination skill root"
              value={root}
              onChange={(next) => setRoot(next as SkillBuildRootId)}
              className="focus-ring w-full cursor-pointer rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)]"
              options={SKILL_BUILD_ROOTS.map((entry) => ({
                value: entry.id,
                label: `${entry.label} (${entry.pathHint})`,
              }))}
            />
            <span className="text-[11px] text-[var(--text-muted)]">{ROOT_HELP[root]}</span>
          </label>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="skill-builder-instructions" className="text-[12px] font-medium text-[var(--text-primary)]">
                Instructions
              </label>
              <Button
                variant="ghost"
                size="xs"
                leadingIcon="ph:magic-wand-fill"
                disabled={instructions.trim().length > 0}
                onClick={() => setInstructions(STARTER_TEMPLATE)}
              >
                Insert starter template
              </Button>
            </div>
            <textarea
              id="skill-builder-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={12}
              placeholder="Markdown the familiar follows — when to use the skill, the steps, and how to verify the result."
              className={`${INPUT_CLASS} resize-y font-mono text-[12px] leading-relaxed`}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-hairline)] pt-4">
            <p className="min-w-0 text-[11px] text-[var(--text-muted)]">
              Writes <span className="break-all font-mono text-[var(--text-secondary)]">{destination}</span>
            </p>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              leadingIcon="ph:hammer"
              loading={saving}
              disabled={!ready}
            >
              Save skill
            </Button>
          </div>
        </form>

        <section aria-label="SKILL.md preview" className="flex min-w-0 flex-col gap-2">
          <p className="text-[12px] font-medium text-[var(--text-primary)]">
            Preview <span className="font-normal text-[var(--text-muted)]">— the exact file that will be written</span>
          </p>
          <pre className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-panel)] px-4 py-3 font-mono text-[11.5px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">
            {preview}
          </pre>
        </section>
      </div>
    </div>
  );
}
