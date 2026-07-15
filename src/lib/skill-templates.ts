/**
 * Skill templates — the Build tab's starter gallery
 * (docs/authoring-assist.md §1, cave-6ptj).
 *
 * Templates are pure prefill data (the AUTOMATION_TEMPLATES stance): one per
 * skill *kind*, with instructions written in the prompt-pack
 * `{{placeholder|default}}` grammar so inserting one drops straight into the
 * Tab-fill flow (src/lib/prompt-placeholders.ts). Built-ins merge with
 * pack-shipped and user templates by id — `user > pack > built-in`, the same
 * precedence prompt templates use — via GET /api/skills/templates.
 */

export type SkillTemplate = {
  id: string;
  name: string;
  /** One-line hint shown on the gallery card. */
  description: string;
  /** Prefilled into the tags field when it is still empty. */
  tags: readonly string[];
  /** Instructions body with `{{placeholder|default}}` blanks. */
  instructions: string;
  /** Where the template came from (built-in, a pack id, or the user dir). */
  source: "builtin" | `pack:${string}` | "user";
};

export const SKILL_TEMPLATES: readonly SkillTemplate[] = [
  {
    id: "procedure",
    name: "Procedure",
    description: "A repeatable checklist with verification.",
    tags: ["procedure"],
    source: "builtin",
    instructions: `## When to use

Use this skill when {{the situation this skill is for}}.

## Steps

1. {{first step}}
2. {{second step}}
3. Verify the result: {{how to check it worked}}

## Verification

- {{how the familiar proves the work is done}}
`,
  },
  {
    id: "tool-wrapper",
    name: "Tool wrapper",
    description: "Safe use of one CLI or API, flags and failure modes included.",
    tags: ["tool"],
    source: "builtin",
    instructions: `## When to use

Use this skill when the task needs {{the tool|the CLI}} — {{what the tool does}}.

## Invocation

\`\`\`bash
{{command|tool --flag value}}
\`\`\`

- {{flag or argument}} — {{what it controls}}

## Failure modes

- {{error you may see}} → {{how to recover}}

## Never

- {{what this tool must never be used for}}
`,
  },
  {
    id: "reference",
    name: "Reference / lookup",
    description: "Authoritative facts the familiar should consult, not guess.",
    tags: ["reference"],
    source: "builtin",
    instructions: `## When to use

Consult this skill when {{the topic}} comes up — do not answer from memory.

## Facts

- {{fact one}}
- {{fact two}}

## Sources

- {{where this is documented|internal doc}} — treat as authoritative.
`,
  },
  {
    id: "review",
    name: "Review / verification",
    description: "A quality gate: what to check before calling work done.",
    tags: ["review"],
    source: "builtin",
    instructions: `## When to use

Use this skill before declaring {{the kind of work|a change}} complete.

## Checklist

- [ ] {{first check}}
- [ ] {{second check}}
- [ ] {{third check}}

## On failure

{{what to do when a check fails|Fix and re-run the checklist; never skip a failing item.}}
`,
  },
  {
    id: "orchestration",
    name: "Orchestration",
    description: "Coordinating a multi-step flow across tools or agents.",
    tags: ["workflow"],
    source: "builtin",
    instructions: `## When to use

Use this skill when {{the goal}} needs {{the stages|several coordinated steps}}.

## Flow

1. **{{stage one}}** — {{what it produces}}
2. **{{stage two}}** — depends on stage one's {{artifact}}
3. **{{final stage}}** — {{the definition of done}}

## Handoffs

- Between stages, carry forward: {{what context must not be lost}}

## Verification

- {{how to prove the whole flow succeeded}}
`,
  },
];

export function skillTemplateById(
  templates: readonly SkillTemplate[],
  id: unknown,
): SkillTemplate | null {
  if (typeof id !== "string" || !id) return null;
  return templates.find((template) => template.id === id) ?? null;
}

/** Merge template sources by id — `user > pack > built-in`, the prompt
 *  templates precedence. Later duplicates within a tier are ignored. */
export function mergeSkillTemplates(
  builtins: readonly SkillTemplate[],
  packs: readonly SkillTemplate[],
  user: readonly SkillTemplate[],
): SkillTemplate[] {
  const byId = new Map<string, SkillTemplate>();
  for (const tier of [builtins, packs, user]) {
    const seen = new Set<string>();
    for (const template of tier) {
      if (seen.has(template.id)) continue;
      seen.add(template.id);
      byId.set(template.id, template);
    }
  }
  return [...byId.values()];
}
