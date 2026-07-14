"use client";

// Skill Builder — the Marketplace "Build" tab. Author a new SKILL.md (name,
// description, tags, instructions) with a live preview of the exact file that
// will be written, and save it into one of the local skill roots the app
// scans (Coven shared / Claude Code / Codex / shared agents). Saving goes
// through POST /api/skills/build (creation-only; duplicates are refused), so
// the new skill shows up in the Skills tab immediately.
//
// Authoring assist (docs/authoring-assist.md §1–§3):
//  - a template GALLERY (built-in kinds merged with pack/user templates via
//    GET /api/skills/templates) whose bodies Tab-fill through the shared
//    {{placeholder|default}} engine (cave-6ptj);
//  - "Draft with AI" — POST /api/skills/draft runs one bounded read-only
//    assist and fills the form for review; the live preview and the
//    creation-only save stay the trust boundary (cave-yz8n);
//  - in-place Enhance on the instructions field (the shared
//    use-prompt-enhance state machine) and a "Build in chat" brief carrying
//    the full build API contract (cave-yz8n);
//  - a dry-run tester on the success panel — trigger check + narration-only
//    walkthrough through POST /api/skills/dry-run (cave-cyfc).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { StandardSelect } from "@/components/ui/select";
import { useAnnouncer } from "@/components/ui/live-region";
import type { FamiliarForSkill } from "@/components/skill-detail-drawer";
import { handlePlaceholderTab, placeholderSpans } from "@/lib/prompt-placeholders";
import { buildSkillAgentPrompt } from "@/lib/skill-agent-prompt";
import {
  composeSkillMd,
  MAX_SKILL_DESCRIPTION_CHARS,
  MAX_SKILL_NAME_CHARS,
  SKILL_BUILD_ROOTS,
  slugifySkillName,
  type SkillBuildRootId,
} from "@/lib/skill-build-format";
import { SKILL_TEMPLATES, type SkillTemplate } from "@/lib/skill-templates";
import { usePromptEnhance } from "@/lib/use-prompt-enhance";

const ROOT_HELP: Record<SkillBuildRootId, string> = {
  coven: "Shared Coven root — every familiar in your Cave can load it.",
  claude: "Claude Code's user skills — loaded by Claude Code sessions.",
  codex: "Codex's user skills — loaded by Codex sessions.",
  agents: "The cross-agent ~/.agents root shared by Skills-CLI harnesses.",
};

const INPUT_CLASS =
  "focus-ring w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--border-strong)]";

/** What the success panel needs to keep testing the skill after the save. */
type SavedSkill = {
  slug: string;
  path: string;
  name: string;
  description: string;
  instructions: string;
};

type DryRunVerdict =
  | { mode: "trigger"; fires: boolean; reason: string }
  | { mode: "walkthrough"; followed: "yes" | "partial" | "no"; notes: string[] };

type Props = {
  /** Fired after a successful save so the hub can refresh the Skills list. */
  onSaved?: () => void;
  /** Jumps to the Skills tab (the success panel's "View in Skills"). */
  onViewSkills?: () => void;
  /** Familiars roster — powers the model-backed Enhance (offline fallback otherwise). */
  familiars?: FamiliarForSkill[];
};

export function SkillBuilder({ onSaved, onViewSkills, familiars = [] }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [root, setRoot] = useState<SkillBuildRootId>("coven");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedSkill | null>(null);
  const { announce } = useAnnouncer();
  const instructionsRef = useRef<HTMLTextAreaElement | null>(null);

  // ── Template gallery (cave-6ptj) ──────────────────────────────────────────
  // Built-ins render immediately; the merged list (pack/user overrides by id)
  // replaces them when the templates route answers. Failure keeps built-ins.
  const [templates, setTemplates] = useState<readonly SkillTemplate[]>(SKILL_TEMPLATES);
  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/skills/templates", { cache: "no-store", signal: ctl.signal })
      .then((res) => res.json())
      .then((json: { ok?: boolean; templates?: SkillTemplate[] }) => {
        if (!ctl.signal.aborted && json.ok && Array.isArray(json.templates) && json.templates.length > 0) {
          setTemplates(json.templates);
        }
      })
      .catch(() => {});
    return () => ctl.abort();
  }, []);

  const insertTemplate = useCallback(
    (template: SkillTemplate) => {
      setInstructions(template.instructions);
      setTagsText((current) => (current.trim() ? current : template.tags.join(", ")));
      announce(`Inserted the ${template.name} template.`, "polite");
      // Select the first placeholder so typing replaces it; Tab walks onward.
      requestAnimationFrame(() => {
        const el = instructionsRef.current;
        if (!el) return;
        el.focus();
        const first = placeholderSpans(template.instructions)[0];
        if (first) el.setSelectionRange(first.start, first.end);
      });
    },
    [announce],
  );

  // ── In-place Enhance on the instructions field (cave-yz8n, P1) ────────────
  const enhancer = usePromptEnhance({
    draft: instructions,
    setDraft: setInstructions,
    familiarId: familiars[0]?.id ?? null,
    mode: "task",
    disabled: saving,
  });

  // ── Draft with AI (cave-yz8n, P2) ─────────────────────────────────────────
  const [draftGoal, setDraftGoal] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const draftWithAi = useCallback(async () => {
    const goal = draftGoal.trim();
    if (!goal || drafting) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const res = await fetch("/api/skills/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: goal }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        draft?: { name: string; description: string; tags: string[]; instructions: string };
        error?: string;
      };
      if (!json.ok || !json.draft) throw new Error(json.error ?? `draft http ${res.status}`);
      setName(json.draft.name);
      setDescription(json.draft.description);
      setTagsText(json.draft.tags.join(", "));
      setInstructions(json.draft.instructions);
      announce("Draft ready — review the form and the preview, then save.", "polite");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "skill draft failed";
      setDraftError(msg);
      announce(msg, "assertive");
    } finally {
      setDrafting(false);
    }
  }, [announce, draftGoal, drafting]);

  /** "Build in chat": the brief-pattern escape hatch — a familiar authors and
   *  saves the skill through the same creation-only API (cave-yz8n, P3). */
  const buildInChat = useCallback(() => {
    const goal = draftGoal.trim() || description.trim() || name.trim();
    if (!goal) return;
    window.dispatchEvent(
      new CustomEvent("cave:agents-new-chat", {
        detail: { initialPrompt: buildSkillAgentPrompt({ description: goal, root }) },
      }),
    );
    announce("Opened a chat to build this skill together.", "polite");
  }, [announce, description, draftGoal, name, root]);

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
    setDraftGoal("");
    setDraftError(null);
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
      setSaved({ slug: json.slug, path: json.path, name, description, instructions });
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
          <SkillDryRunTester skill={saved} />
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

      <section
        aria-label="Draft with AI"
        className="mb-5 flex max-w-2xl flex-col gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-panel)] px-4 py-3"
      >
        <label htmlFor="skill-draft-goal" className="text-[12px] font-medium text-[var(--text-primary)]">
          Draft with AI <span className="font-normal text-[var(--text-muted)]">— describe the skill; a reviewable draft fills the form</span>
        </label>
        <textarea
          id="skill-draft-goal"
          value={draftGoal}
          onChange={(e) => setDraftGoal(e.target.value)}
          rows={2}
          placeholder="e.g. Turning merged PRs into user-facing release notes, grouped by area, with links."
          className={`${INPUT_CLASS} resize-y`}
        />
        {draftError ? (
          <p role="alert" className="text-[11px] text-[var(--danger-text)]">
            {draftError}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon="ph:sparkle"
            loading={drafting}
            disabled={!draftGoal.trim()}
            onClick={() => void draftWithAi()}
          >
            Draft with AI
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon="ph:chat-circle-dots"
            disabled={!draftGoal.trim() && !description.trim() && !name.trim()}
            onClick={buildInChat}
            title="Open a chat where a familiar authors and saves the skill through the build API"
          >
            Build in chat
          </Button>
          <span className="text-[11px] text-[var(--text-muted)]">
            Nothing is written until you review and save.
          </span>
        </div>
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
              <div className="flex items-center gap-1.5">
                {enhancer.state.phase === "suggested" ? (
                  <>
                    <Button variant="secondary" size="xs" leadingIcon="ph:check" onClick={enhancer.apply}>
                      Apply rewrite
                    </Button>
                    <Button variant="ghost" size="xs" onClick={enhancer.dismiss}>
                      Dismiss
                    </Button>
                  </>
                ) : enhancer.state.phase === "applied" ? (
                  <Button variant="ghost" size="xs" leadingIcon="ph:arrow-counter-clockwise" onClick={enhancer.revert}>
                    Revert enhance
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="xs"
                    leadingIcon="ph:magic-wand-fill"
                    loading={enhancer.state.phase === "loading"}
                    disabled={!instructions.trim()}
                    onClick={() => enhancer.enhance()}
                    title="Rewrite the instructions in place — applied only if you haven't typed meanwhile"
                  >
                    Enhance
                  </Button>
                )}
              </div>
            </div>
            <div role="group" aria-label="Skill templates" className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[11px] text-[var(--text-muted)]">Start from</span>
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  title={template.description}
                  disabled={instructions.trim().length > 0}
                  onClick={() => insertTemplate(template)}
                  className="focus-ring inline-flex h-[24px] items-center rounded-md border border-[var(--border-hairline)] px-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {template.name}
                </button>
              ))}
            </div>
            <textarea
              id="skill-builder-instructions"
              ref={instructionsRef}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              onKeyDown={(e) => handlePlaceholderTab(e, instructionsRef.current, setInstructions)}
              rows={12}
              placeholder="Markdown the familiar follows — when to use the skill, the steps, and how to verify the result."
              className={`${INPUT_CLASS} resize-y font-mono text-[12px] leading-relaxed`}
            />
            {enhancer.state.phase === "error" ? (
              <p role="alert" className="text-[11px] text-[var(--danger-text)]">
                {enhancer.state.message}
              </p>
            ) : null}
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

/**
 * The dry-run tester (cave-cyfc): scenario in, verdicts out. Trigger check
 * proves the description fires; the walkthrough narrates the steps and lists
 * what a familiar couldn't follow. Advisory — never gates anything.
 */
export function SkillDryRunTester({
  skill,
}: {
  skill: { name: string; description: string; instructions?: string };
}) {
  const { announce } = useAnnouncer();
  const [scenario, setScenario] = useState("");
  const [probing, setProbing] = useState<"trigger" | "walkthrough" | null>(null);
  const [verdict, setVerdict] = useState<DryRunVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  const probe = useCallback(
    async (mode: "trigger" | "walkthrough") => {
      const line = scenario.trim();
      if (!line || probing) return;
      setProbing(mode);
      setError(null);
      setVerdict(null);
      try {
        const res = await fetch("/api/skills/dry-run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode,
            name: skill.name,
            description: skill.description,
            scenario: line,
            ...(mode === "walkthrough" ? { instructions: skill.instructions ?? "" } : {}),
          }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          fires?: boolean;
          reason?: string;
          followed?: "yes" | "partial" | "no";
          notes?: string[];
          error?: string;
        };
        if (!json.ok) throw new Error(json.error ?? `dry-run http ${res.status}`);
        if (mode === "trigger") {
          setVerdict({ mode, fires: Boolean(json.fires), reason: json.reason ?? "" });
          announce(json.fires ? "The skill fires for this scenario." : "The skill does not fire.", "polite");
        } else {
          setVerdict({ mode, followed: json.followed ?? "no", notes: json.notes ?? [] });
          announce("Walkthrough finished.", "polite");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "dry-run failed";
        setError(msg);
        announce(msg, "assertive");
      } finally {
        setProbing(null);
      }
    },
    [announce, probing, scenario, skill.description, skill.instructions, skill.name],
  );

  return (
    <div className="flex w-full flex-col gap-2 border-t border-[var(--border-hairline)] pt-3" data-testid="skill-dry-run">
      <p className="text-[12px] font-medium text-[var(--text-primary)]">
        Test this skill{" "}
        <span className="font-normal text-[var(--text-muted)]">— would a familiar pick it up?</span>
      </p>
      <input
        type="text"
        value={scenario}
        onChange={(e) => setScenario(e.target.value)}
        placeholder="A scenario, e.g. “the user asks for release notes for last week's merges”"
        aria-label="Dry-run scenario"
        className={INPUT_CLASS}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          leadingIcon="ph:target"
          loading={probing === "trigger"}
          disabled={!scenario.trim() || probing !== null}
          onClick={() => void probe("trigger")}
          title="Given only the name + description, would an agent load this skill?"
        >
          Test trigger
        </Button>
        {skill.instructions ? (
          <Button
            variant="ghost"
            size="sm"
            leadingIcon="ph:list-checks-bold"
            loading={probing === "walkthrough"}
            disabled={!scenario.trim() || probing !== null}
            onClick={() => void probe("walkthrough")}
            title="Narrate the steps against the scenario and report what couldn't be followed"
          >
            Walk through steps
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-[11px] text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
      {verdict?.mode === "trigger" ? (
        <p className="text-[12px] text-[var(--text-secondary)]" aria-live="polite">
          <strong className={verdict.fires ? "text-[var(--text-primary)]" : "text-[var(--danger-text)]"}>
            {verdict.fires ? "Fires" : "Does not fire"}
          </strong>{" "}
          — {verdict.reason}
        </p>
      ) : null}
      {verdict?.mode === "walkthrough" ? (
        <div className="text-[12px] text-[var(--text-secondary)]" aria-live="polite">
          <p>
            <strong className="text-[var(--text-primary)]">
              {verdict.followed === "yes" ? "Followable" : verdict.followed === "partial" ? "Partially followable" : "Not followable"}
            </strong>
          </p>
          <ul className="mt-1 list-disc pl-5">
            {verdict.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
