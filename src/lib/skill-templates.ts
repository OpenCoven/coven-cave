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
  {
    id: "image-prompt-crafter",
    name: "Image prompt crafter",
    description: "Turn a rough idea into a strong /image prompt.",
    tags: ["image", "creative"],
    source: "builtin",
    instructions: `## When to use

Use this skill when the user wants an image but gives only a rough idea — expand it into a strong /image prompt before generating.

## Prompt recipe

Build the prompt in this order:

1. **Subject** — the main thing, specific: {{typical subjects|"a lighthouse keeper's desk"}}
2. **Style** — {{default style|watercolor illustration, soft edges}}
3. **Composition** — framing and viewpoint (close-up, wide shot, isometric…)
4. **Lighting & mood** — {{default mood|warm candlelight, quiet evening}}
5. **Constraints** — what to avoid: {{things to avoid|text, watermarks, extra limbs}}

## Steps

1. Draft the expanded prompt from the recipe above.
2. Show it to the user for a quick yes/no before generating.
3. Generate with \`/image <expanded prompt>\`.
4. If the result misses, change ONE recipe line and regenerate — don't rewrite everything.

## Never

- Include artist names still under copyright when asked to imitate them exactly.
`,
  },
  {
    id: "brand-image-style",
    name: "Brand image style",
    description: "Keep every generated image on one visual identity.",
    tags: ["image", "brand"],
    source: "builtin",
    instructions: `## When to use

Use this skill whenever generating images for {{the project or brand}} so every /image result shares one visual identity.

## Style constants

Append these to EVERY image prompt for this brand:

- Palette: {{brand colors|deep violet, candle-orange accents, charcoal background}}
- Style: {{rendering style|flat vector with subtle grain}}
- Mood: {{brand mood|mystical but friendly}}
- Always: {{required elements|generous negative space}}
- Never: {{banned elements|photorealism, stock-photo look, embedded text}}

## Usage

1. Take the user's subject.
2. Compose: \`/image <subject>, <palette>, <style>, <mood>, <always>\`.
3. On revisions, keep the style constants fixed — only the subject changes.
`,
  },
  {
    id: "diagram-illustrator",
    name: "Diagram illustrator",
    description: "Explain a concept with a generated illustration.",
    tags: ["image", "docs"],
    source: "builtin",
    instructions: `## When to use

Use this skill when a concept in {{the domain|the codebase or docs}} would land better as a picture than a paragraph.

## Steps

1. Reduce the concept to its 3-5 essential parts and their relationships.
2. Pick a visual metaphor: {{preferred metaphors|flowchart, layered stack, orbit map}}.
3. Generate: \`/image clean minimal diagram of <parts and relationships>, <metaphor>, flat design, high contrast, no text labels\`.
4. Present the image WITH a one-paragraph caption naming each part — generated images cannot carry reliable text, so the caption does the labeling.

## Verification

- Every part listed in step 1 is visually distinguishable in the result.
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
