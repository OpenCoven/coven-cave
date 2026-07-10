# UI consistency Phase 0 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to implement this plan step by step.
> Repository progress is tracked in Beads issue `cave-xd1b.1`; the numbered
> steps below are execution order, not a second task tracker.

**Goal:** Establish the enforceable field, copy, and conformance foundation for
the approved cross-platform UI consistency program without migrating product
surfaces yet.

**Architecture:** Extend the existing Coven design language instead of creating
a competing guide. Add a composable React field context with focused text-input
and text-area controls, demonstrate it on the live aesthetic reference, and
introduce a deterministic line-oriented source scanner whose reviewed baseline
can only shrink. Contextual prose remains beside its surface; shared code owns
semantics, styling, and regression enforcement.

**Tech stack:** Next.js 16, React 19, TypeScript 6, plain CSS semantic tokens,
Node 24 ESM scripts, Node `assert` source-contract tests, Playwright/Chromium,
Beads, Git/GitHub protected PR workflow.

**Design authority:**
`docs/superpowers/specs/2026-07-09-cross-platform-ui-consistency-design.md`

**Durable tracking:** `cave-xd1b.1` is the only claimed implementation bead.
The umbrella `cave-xd1b` stays open and unassigned.

---

## Scope boundary

This plan implements Phase 0 only:

- the authoritative interface-copy contract;
- `Field`, `TextInput`, and `TextArea`;
- live examples on `/aesthetic`;
- scanner infrastructure, an audited starting inventory, debt baseline,
  semantic exceptions, and CI wiring;
- focused, full-suite, build, and real-browser verification.

It does not migrate Home, Chat, Tasks, Projects, Settings, iOS, or Tauri
system copy. Those are separate child beads and bounded plans after this
foundation merges.

## File map

- Modify `docs/coven-design-language.md`: add the authoritative copy and
  field contract consumed by contributors and pinned by tests.
- Create `src/components/ui/field.tsx`: field grouping, persistent labels,
  optional marker, help/error slots, deterministic IDs, and context wiring.
- Create `src/components/ui/text-input.tsx`: standard single-line control
  that consumes field semantics while forwarding native attributes and refs.
- Create `src/components/ui/text-area.tsx`: standard multiline control with
  the same field semantics.
- Create `src/components/ui/field.test.ts`: source-contract tests for the
  field family and its CSS/accessibility invariants.
- Modify `src/app/globals.css`: token-only field, input, textarea, invalid,
  disabled, read-only, placeholder, focus, and touch styling.
- Modify `src/app/aesthetic/page.tsx`: live field examples using serializable
  defaults so the page can remain a server component.
- Create `src/app/aesthetic/aesthetic-fields.test.ts`: pin every required
  reference state.
- Create `scripts/ui-consistency-policy.mjs`: live roots, active Phase 0
  rule definitions, and reasoned semantic exceptions.
- Create `scripts/ui-consistency.mjs`: filesystem scan, finding
  normalization, baseline/exception comparison, stale-debt detection, CLI.
- Create `scripts/ui-consistency-baseline.json`: starting revision,
  inventory, and exact reviewed Phase 0 debt.
- Create `scripts/ui-consistency.test.mjs`: documentation, seeded rule,
  comparison, exception, and repository-integration tests.
- Modify `scripts/run-tests.mjs`: wire every new test into the app suite.
- Modify `package.json`: expose `pnpm check:ui-consistency`.

## Implementation preflight

Refresh the protected base before changing product code, then reconfirm the
single claimed Bead and branch identity:

```bash
git fetch origin main
git rebase -S origin/main
bd show cave-xd1b.1 --json
git status --short --branch
git log -2 --show-signature --format=fuller
```

Expected: the branch is based on the current `origin/main`, `cave-xd1b.1`
remains the sole claimed implementation bead, the worktree is clean, and both
approved planning commits retain good signatures. If the rebase conflicts,
resolve only files owned by this plan and rerun the baseline app suite before
continuing.

## Task 1: Make the copy contract authoritative and executable

**Files:**

- Create: `scripts/ui-consistency.test.mjs`
- Modify: `docs/coven-design-language.md:289-311`
- Modify: `scripts/run-tests.mjs:545-558`

### Step 1: Create the failing documentation contract test

Create `scripts/ui-consistency.test.mjs` with:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const designLanguage = readFileSync(
  new URL("../docs/coven-design-language.md", import.meta.url),
  "utf8",
);

for (const heading of [
  "## 10. Interface copy and field contract",
  "### Vocabulary",
  "### Action copy",
  "### Field semantics",
  "### Placeholder grammar",
  "### State copy",
]) {
  assert.match(
    designLanguage,
    new RegExp(heading.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&")),
    `design language contains ${heading}`,
  );
}

assert.match(
  designLanguage,
  /\*\*Tasks\*\* is the top-level user-facing noun/,
  "Tasks is the canonical destination noun",
);
assert.match(
  designLanguage,
  /A placeholder never replaces a persistent label/,
  "placeholder-only labeling is forbidden",
);
assert.match(
  designLanguage,
  /`Search <items>…`/,
  "search placeholder grammar is explicit",
);
assert.match(
  designLanguage,
  /\*\*Couldn't load <object>\*\*/,
  "failure grammar names the failed object",
);

console.log("ui-consistency.test.mjs: copy contract ok");
```

### Step 2: Run the test and verify the expected failure

Run:

```bash
node scripts/ui-consistency.test.mjs
```

Expected: FAIL on `design language contains ## 10. Interface copy and field
contract`.

### Step 3: Append the approved contract to the design language

Insert the following section immediately before the final related-links rule in
`docs/coven-design-language.md`:

```markdown
## 10. Interface copy and field contract

The visual rules above and the language rules below form one interface
contract. Contextual prose stays with its surface; reusable components own
control semantics, state hierarchy, and accessibility.

### Vocabulary

- **Tasks** is the top-level user-facing noun in navigation, mobile tabs,
  headings, commands, empty states, and actions. Use **task board** when the
  kanban/table layout itself matters. Do not use bare **Board** as a
  destination.
- Use **task** instead of visible **card** unless describing card-shaped
  presentation. Internal card types and APIs do not need cosmetic renames.
- Use **chat** for a conversation people open and **session** only for
  execution, debugging, or connection contexts where the distinction matters.
- Keep the domain nouns in §4. Use **scheduled job** in ordinary interface
  copy; reserve **cron** for cron syntax and scheduler diagnostics.
- Use **project** for the user-facing codebase container. Use **working
  directory** or `cwd` only when the filesystem concept is the actual field.

### Action copy

- Use sentence case, active voice, and the action's real verb: **Save changes**,
  **Create task**, **Open settings**, **Retry**.
- Avoid generic **Submit**, **OK**, and **Confirm** when the actual operation is
  known.
- Keep one verb through the lifecycle: **Publish** → **Publishing…** →
  **Published**.
- Icon-only controls need state-aware accessible names. Toggle names describe
  the next action: **Pin chat** / **Unpin chat**.
- Name destructive objects and consequences. Prefer undo for reversible
  actions; use confirmation for irreversible actions.

### Field semantics

- Every editable control has a persistent visible label or an equally durable
  accessible name for a self-explanatory global control. A placeholder never
  replaces a persistent label.
- Put purpose in the label, constraints in help text, and repair instructions
  in the error slot. One string does not perform multiple jobs.
- Mark optional fields beside the label with **Optional**. Required controls
  use native required semantics rather than decorative asterisks.
- Connect help and errors with `aria-describedby` on React and equivalent
  native accessibility semantics. Invalid controls expose their invalid state
  programmatically.

### Placeholder grammar

Placeholders show an example, expected format, or input intent. They do not
repeat the label, hold required instructions, disguise a default value, or
carry a keyboard shortcut that disappears while typing.

- Search a known collection: `Search <items>…`
- Narrow a visible collection: `Filter <items>…`
- Open a deferred choice: `Choose <item>…`
- Create or compose: `Describe the task…`, `Message Sage…`, `Add a note…`
- Show format: `e.g., owner/repository` or `e.g., 0 9 * * 1-5`
- Secret input: `Paste personal access token`, paired with a provider-specific
  label

Use the single ellipsis character `…`, never three periods. Put optionality,
shortcut hints, and critical constraints in persistent text outside the
placeholder.

### State copy

- Name small loads: **Loading tasks…**, not bare **Loading…**. Use skeletons
  when the content shape is known.
- A true empty state has a short status headline, a concrete next step, and an
  action when the person can resolve it.
- A filtered empty state names the scope or query and offers **Clear filters**
  where appropriate.
- Never render a failed request as a convincing empty collection. Use
  **Couldn't load <object>**, safe diagnostic detail, and a concrete recovery
  action such as **Retry** or **Open settings**.
- Announcements and toasts use the same action vocabulary as the visible
  control.
```

Update the shipping checklist's copy item to point to §10:

```markdown
7. Copy follows §10: sentence case, persistent labels, canonical placeholders,
   actionable state copy, one flourish maximum, and domain nouns rather than
   synonyms.
```

### Step 4: Run the focused test and verify it passes

Run:

```bash
node scripts/ui-consistency.test.mjs
```

Expected: `ui-consistency.test.mjs: copy contract ok`.

### Step 5: Wire the test into the app suite

Add this entry next to `src/components/minimalism-invariants.test.ts` in
`scripts/run-tests.mjs`:

```js
    "scripts/ui-consistency.test.mjs",
```

Run:

```bash
pnpm check:tests-wired
```

Expected: PASS with every test file wired and no stale allowlist entry.

### Step 6: Commit the contract

Run:

```bash
git add docs/coven-design-language.md scripts/ui-consistency.test.mjs scripts/run-tests.mjs
git diff --cached --check
git commit -S -m "docs(ui): codify interface copy contract"
```

Expected: a signed commit containing only the copy contract and its wired test.

## Task 2: Add the accessible React field family

**Files:**

- Create: `src/components/ui/field.test.ts`
- Create: `src/components/ui/field.tsx`
- Create: `src/components/ui/text-input.tsx`
- Create: `src/components/ui/text-area.tsx`
- Modify: `src/app/globals.css:2149-2155`
- Modify: `scripts/run-tests.mjs:545-560`

### Step 1: Write the failing field-family contract test

Create `src/components/ui/field.test.ts` with:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const field = readFileSync(new URL("./field.tsx", import.meta.url), "utf8");
const input = readFileSync(new URL("./text-input.tsx", import.meta.url), "utf8");
const area = readFileSync(new URL("./text-area.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

assert.match(field, /createContext<FieldContextValue \| null>/, "Field owns typed context");
assert.match(field, /const generatedId = useId\(\)/, "Field generates a stable React id");
assert.match(field, /<label className="ui-field__label" htmlFor=\{controlId\}>/, "label targets the control");
assert.match(field, /id=\{descriptionId\}/, "description has a stable id");
assert.match(field, /id=\{errorId\} role="alert"/, "error has a stable announced slot");
assert.match(field, /optional && !required/, "optional marker cannot conflict with required");
assert.match(field, /export function useFieldControlProps/, "controls consume shared field semantics");
assert.match(field, /joinIds\(context\?\.describedBy, props\["aria-describedby"\]\)/, "consumer descriptions are preserved");

for (const [source, component, element, className] of [
  [input, "TextInput", "input", "ui-text-input"],
  [area, "TextArea", "textarea", "ui-text-area"],
] as const) {
  assert.match(source, new RegExp(`forwardRef<.*${component}`), `${component} forwards its ref`);
  assert.match(source, /useFieldControlProps\(rest\)/, `${component} consumes field context`);
  assert.match(source, new RegExp(`<${element}`), `${component} renders native ${element}`);
  assert.match(source, new RegExp(className), `${component} uses shared chrome`);
}

const fieldCss = css.match(/\/\* ---- Field family[\s\S]*?\/\* ---- Button/)?.[0] ?? "";
assert.match(fieldCss, /\.ui-text-input,[\s\S]*\.ui-text-area/, "controls share base chrome");
assert.match(fieldCss, /\[aria-invalid="true"\]/, "invalid controls have a visual state");
assert.match(fieldCss, /:focus-visible[\s\S]*var\(--ring-focus\)/, "focus is token driven");
assert.match(fieldCss, /:disabled/, "disabled controls are explicit");
assert.match(fieldCss, /:read-only/, "read-only controls are distinct");
assert.match(fieldCss, /::placeholder/, "placeholder styling is centralized");
assert.match(
  fieldCss,
  /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*font-size:\s*16px/,
  "touch fields prevent iOS input zoom",
);
assert.doesNotMatch(fieldCss, /#[0-9a-f]{3,8}\b|rgba?\(/i, "field family has no hardcoded colors");

console.log("field.test.ts: ok");
```

### Step 2: Run the test and verify it fails because the family is absent

Run:

```bash
node --experimental-strip-types src/components/ui/field.test.ts
```

Expected: FAIL with `ENOENT` for `field.tsx`, `text-input.tsx`, or
`text-area.tsx`.

### Step 3: Implement field grouping and accessibility propagation

Create `src/components/ui/field.tsx` with:

```tsx
"use client";

import {
  createContext,
  useContext,
  useId,
  type AriaAttributes,
  type ReactNode,
} from "react";

type FieldContextValue = {
  controlId: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

export type FieldProps = {
  id?: string;
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  required?: boolean;
  children: ReactNode;
  className?: string;
};

export type FieldControlProps = {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
};

function joinIds(...values: Array<string | undefined>): string | undefined {
  const ids = values
    .flatMap((value) => value?.split(/\s+/) ?? [])
    .filter(Boolean);
  const unique = [...new Set(ids)];
  return unique.length ? unique.join(" ") : undefined;
}

export function Field({
  id,
  label,
  description,
  error,
  optional = false,
  required = false,
  children,
  className,
}: FieldProps) {
  const generatedId = useId();
  const controlId = id ?? `ui-field-${generatedId.replace(/:/g, "")}`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = joinIds(descriptionId, errorId);
  const invalid = Boolean(error);
  const classes = ["ui-field", className ?? ""].filter(Boolean).join(" ");

  return (
    <FieldContext.Provider value={{ controlId, describedBy, invalid, required }}>
      <div className={classes} data-invalid={invalid || undefined}>
        <div className="ui-field__label-row">
          <label className="ui-field__label" htmlFor={controlId}>
            {label}
          </label>
          {optional && !required ? <span className="ui-field__optional">Optional</span> : null}
        </div>
        {children}
        {description ? (
          <div className="ui-field__description" id={descriptionId}>
            {description}
          </div>
        ) : null}
        {error ? (
          <div className="ui-field__error" id={errorId} role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

export function useFieldControlProps<T extends FieldControlProps>(
  props: T,
): T & FieldControlProps {
  const context = useContext(FieldContext);
  if (!context) return props;

  return {
    ...props,
    id: props.id ?? context.controlId,
    required: props.required ?? context.required,
    "aria-describedby": joinIds(context?.describedBy, props["aria-describedby"]),
    "aria-invalid": props["aria-invalid"] ?? (context.invalid || undefined),
  };
}
```

### Step 4: Implement the native input wrappers

Create `src/components/ui/text-input.tsx` with:

```tsx
"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { useFieldControlProps } from "@/components/ui/field";

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className, type = "text", ...rest },
  ref,
) {
  const controlProps = useFieldControlProps(rest);
  const classes = ["ui-text-input", className ?? ""].filter(Boolean).join(" ");

  return <input {...controlProps} ref={ref} type={type} className={classes} />;
});
```

Create `src/components/ui/text-area.tsx` with:

```tsx
"use client";

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { useFieldControlProps } from "@/components/ui/field";

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, ...rest },
  ref,
) {
  const controlProps = useFieldControlProps(rest);
  const classes = ["ui-text-area", className ?? ""].filter(Boolean).join(" ");

  return <textarea {...controlProps} ref={ref} className={classes} />;
});
```

### Step 5: Add token-only shared field styles

Insert this block before the Button section in `src/app/globals.css`:

```css
/* ---- Field family ------------------------------------------- */
.ui-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-2);
}

.ui-field__label-row {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.ui-field__label {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: 600;
  line-height: var(--leading-tight);
}

.ui-field__optional {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.ui-field__description,
.ui-field__error {
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
}

.ui-field__description {
  color: var(--text-muted);
}

.ui-field__error {
  color: var(--color-danger);
}

.ui-field[data-invalid="true"] .ui-field__label {
  color: var(--color-danger);
}

.ui-text-input,
.ui-text-area {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--text-base);
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    background-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard);
}

.ui-text-input {
  min-height: var(--space-8);
  padding: 0 var(--space-3);
}

.ui-text-area {
  min-height: calc(var(--space-10) * 2);
  padding: var(--space-2) var(--space-3);
  resize: vertical;
  line-height: var(--leading-normal);
}

.ui-text-input::placeholder,
.ui-text-area::placeholder {
  color: var(--text-muted);
  opacity: 1;
}

.ui-text-input:hover:not(:disabled),
.ui-text-area:hover:not(:disabled) {
  border-color: color-mix(in oklch, var(--foreground) 36%, transparent);
}

.ui-text-input:focus-visible,
.ui-text-area:focus-visible {
  border-color: var(--ring-focus);
  outline: var(--ring-width) solid var(--ring-focus);
  outline-offset: var(--ring-offset-inset);
}

.ui-text-input[aria-invalid="true"],
.ui-text-area[aria-invalid="true"] {
  border-color: var(--color-danger);
}

.ui-text-input[aria-invalid="true"]:focus-visible,
.ui-text-area[aria-invalid="true"]:focus-visible {
  outline-color: var(--color-danger);
}

.ui-text-input:disabled,
.ui-text-area:disabled {
  cursor: not-allowed;
  opacity: var(--opacity-disabled);
}

.ui-text-input:read-only:not(:disabled),
.ui-text-area:read-only:not(:disabled) {
  background: var(--bg-raised);
  color: var(--text-secondary);
}

@media (hover: none) and (pointer: coarse) {
  .ui-text-input,
  .ui-text-area {
    min-height: var(--touch-target);
    font-size: 16px;
  }
}
```

### Step 6: Run focused verification

Run:

```bash
node --experimental-strip-types src/components/ui/field.test.ts
pnpm typecheck
```

Expected: `field.test.ts: ok` and TypeScript exits 0.

### Step 7: Wire and commit the field family

Add this app-suite entry beside the other UI primitive tests:

```js
    "src/components/ui/field.test.ts",
```

Run:

```bash
pnpm check:tests-wired
git add src/components/ui/field.tsx src/components/ui/text-input.tsx src/components/ui/text-area.tsx src/components/ui/field.test.ts src/app/globals.css scripts/run-tests.mjs
git diff --cached --check
git commit -S -m "feat(ui): add accessible field primitives"
```

Expected: the focused test and wiring guard pass, followed by a signed commit.

## Task 3: Demonstrate the complete field state matrix on `/aesthetic`

**Files:**

- Create: `src/app/aesthetic/aesthetic-fields.test.ts`
- Modify: `src/app/aesthetic/page.tsx:1-233`
- Modify: `scripts/run-tests.mjs:545-562`

### Step 1: Write the failing aesthetic reference test

Create `src/app/aesthetic/aesthetic-fields.test.ts` with:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

for (const imported of ["Field", "TextInput", "TextArea"]) {
  assert.match(page, new RegExp(`\\b${imported}\\b`), `aesthetic imports ${imported}`);
}

assert.match(page, /<Section title="Fields">/, "reference exposes a Fields section");
assert.match(page, /label="Project name"[\s\S]*required/, "required + described state is visible");
assert.match(page, /label="Summary"[\s\S]*optional[\s\S]*<TextArea/, "optional multiline state is visible");
assert.match(page, /label="Repository path"[\s\S]*error="Enter an absolute project path"/, "invalid state is visible");
assert.match(page, /label="Saved owner"[\s\S]*readOnly/, "read-only state is visible");
assert.match(page, /label="Unavailable runtime"[\s\S]*disabled/, "disabled state is visible");
assert.match(page, /placeholder="e\.g\., Coven Cave"/, "example placeholder follows the contract");
assert.match(page, /placeholder="Describe the task…"/, "intent placeholder uses a true ellipsis");

console.log("aesthetic-fields.test.ts: ok");
```

### Step 2: Run the test and verify the expected failure

Run:

```bash
node --experimental-strip-types src/app/aesthetic/aesthetic-fields.test.ts
```

Expected: FAIL because `Field`, `TextInput`, `TextArea`, and the Fields
section are absent.

### Step 3: Add the field state matrix

Add these imports to `src/app/aesthetic/page.tsx`:

```tsx
import { Field } from "@/components/ui/field";
import { TextArea } from "@/components/ui/text-area";
import { TextInput } from "@/components/ui/text-input";
```

Insert this section before Typography:

```tsx
      <Section title="Fields">
        <div
          className="shell-card"
          style={{
            padding: 20,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 20,
          }}
        >
          <Field
            label="Project name"
            description="Use the name people recognize in task and chat pickers."
            required
          >
            <TextInput placeholder="e.g., Coven Cave" required />
          </Field>

          <Field label="Summary" optional>
            <TextArea placeholder="Describe the task…" />
          </Field>

          <Field
            label="Repository path"
            error="Enter an absolute project path"
          >
            <TextInput defaultValue="coven-cave" />
          </Field>

          <Field
            label="Saved owner"
            description="Read-only values remain selectable."
          >
            <TextInput defaultValue="Sage" readOnly />
          </Field>

          <Field
            label="Unavailable runtime"
            description="Install a runtime before choosing a model."
          >
            <TextInput placeholder="Choose a runtime first" disabled />
          </Field>
        </div>
      </Section>
```

Do not add `"use client"` to the page. These examples use serializable
`defaultValue`, `readOnly`, and `disabled` props, so the existing server
page can host the client primitives without local state.

### Step 4: Run focused verification

Run:

```bash
node --experimental-strip-types src/app/aesthetic/aesthetic-fields.test.ts
node --experimental-strip-types src/components/ui/field.test.ts
pnpm typecheck
```

Expected: both tests print `ok`; typecheck exits 0.

### Step 5: Wire and commit the live reference

Add:

```js
    "src/app/aesthetic/aesthetic-fields.test.ts",
```

to the app suite near the field test.

Run:

```bash
pnpm check:tests-wired
git add src/app/aesthetic/page.tsx src/app/aesthetic/aesthetic-fields.test.ts scripts/run-tests.mjs
git diff --cached --check
git commit -S -m "docs(ui): add field states to aesthetic reference"
```

Expected: a signed commit with the reference page and its wired contract test.

## Task 4: Build the deterministic scanner and comparison engine

**Files:**

- Create: `scripts/ui-consistency-policy.mjs`
- Create: `scripts/ui-consistency.mjs`
- Modify: `scripts/ui-consistency.test.mjs`

### Step 1: Expand the test with seeded rule and drift cases

Replace `scripts/ui-consistency.test.mjs` with:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  compareFindings,
  scanSource,
} from "./ui-consistency.mjs";

const designLanguage = readFileSync(
  new URL("../docs/coven-design-language.md", import.meta.url),
  "utf8",
);

for (const heading of [
  "## 10. Interface copy and field contract",
  "### Vocabulary",
  "### Action copy",
  "### Field semantics",
  "### Placeholder grammar",
  "### State copy",
]) {
  assert.match(
    designLanguage,
    new RegExp(heading.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&")),
    `design language contains ${heading}`,
  );
}

assert.match(designLanguage, /\*\*Tasks\*\* is the top-level user-facing noun/);
assert.match(designLanguage, /A placeholder never replaces a persistent label/);
assert.match(designLanguage, /`Search <items>…`/);
assert.match(designLanguage, /\*\*Couldn't load <object>\*\*/);

const tsxFindings = scanSource({
  path: "src/components/example.tsx",
  source: [
    'const spread = { title: "History", ...shared };',
    '<input placeholder="Search tasks..." />',
    '<span>Waiting for Salem...</span>',
    '<button>Submit</button>',
    '<select value={value}>',
  ].join("\n"),
});
assert.deepEqual(
  tsxFindings.map((finding) => finding.rule),
  [
    "components/no-native-select",
    "copy/no-ascii-ellipsis",
    "copy/no-ascii-ellipsis",
    "copy/no-generic-submit",
  ],
  "scanner finds seeded UI violations without treating spread syntax as copy",
);

const swiftFindings = scanSource({
  path: "apps/ios/CovenCave/CovenCave/Views/Example.swift",
  source: 'Button("Submit") { save() }\nText("Loading tasks...")',
});
assert.deepEqual(
  swiftFindings.map((finding) => finding.rule),
  ["copy/no-ascii-ellipsis", "copy/no-generic-submit"],
  "scanner applies equivalent copy rules to SwiftUI literals",
);

const finding = {
  rule: "copy/no-ascii-ellipsis",
  path: "src/components/example.tsx",
  excerpt: '<input placeholder="Search tasks..." />',
};

assert.equal(compareFindings([finding], [finding], []).ok, true, "exact baseline is clean");
assert.equal(compareFindings([finding], [], []).newFindings.length, 1, "new debt fails");
assert.equal(compareFindings([], [finding], []).resolvedBaseline.length, 1, "stale debt fails");
assert.equal(
  compareFindings(
    [finding],
    [],
    [{ ...finding, reason: "Browser-owned syntax example." }],
  ).ok,
  true,
  "reasoned semantic exception suppresses a live finding",
);
assert.equal(
  compareFindings(
    [],
    [],
    [{ ...finding, reason: "Browser-owned syntax example." }],
  ).staleExceptions.length,
  1,
  "stale exceptions fail",
);
assert.equal(
  compareFindings(
    [finding],
    [],
    [{ ...finding, reason: "" }],
  ).invalidExceptions.length,
  1,
  "exceptions require reasons",
);

console.log("ui-consistency.test.mjs: scanner unit cases ok");
```

### Step 2: Run the test and verify it fails on the missing scanner module

Run:

```bash
node scripts/ui-consistency.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for
`scripts/ui-consistency.mjs`.

### Step 3: Define live roots, active Phase 0 rules, and exceptions

Create `scripts/ui-consistency-policy.mjs` with:

```js
import path from "node:path";

export const LIVE_SOURCE_ROOTS = Object.freeze([
  {
    directory: "src/components",
    extensions: [".tsx"],
    exclude: [],
  },
  {
    directory: "src/app",
    extensions: [".tsx"],
    exclude: ["src/app/mockup"],
  },
  {
    directory: "apps/ios/CovenCave/CovenCave",
    extensions: [".swift"],
    exclude: [],
  },
  {
    directory: "src-tauri/src",
    extensions: [".rs"],
    exclude: [],
  },
]);

const TSX_LITERAL_CONTEXT =
  /(?:placeholder|aria-label|title|headline|description|confirmLabel|cancelLabel)\s*=|\b(?:label|placeholder)\s*:/;
const TSX_TEXT_CONTEXT = />[^<]*\.\.\.[^<]*</;
const SWIFT_UI_CONTEXT =
  /\b(?:Text|Button|Label|TextField|SecureField|ContentUnavailableView|navigationTitle|alert|confirmationDialog|accessibilityLabel)\s*\(/;
const RUST_UI_CONTEXT =
  /(?:\.title\s*\(|--title\b|display alert\b|display dialog\b)/;

function quotedLiterals(line) {
  const values = [];
  for (const expression of [
    /"((?:\\.|[^"\\])*)"/g,
    /'((?:\\.|[^'\\])*)'/g,
    /`((?:\\.|[^`\\])*)`/g,
  ]) {
    for (const match of line.matchAll(expression)) values.push(match[1]);
  }
  return values;
}

function hasAsciiEllipsis({ extension, line }) {
  if (!line.includes("...")) return false;
  const literals = quotedLiterals(line);
  const literalHasEllipsis = literals.some((value) => value.includes("..."));

  if (extension === ".tsx") {
    return (
      (literalHasEllipsis && TSX_LITERAL_CONTEXT.test(line)) ||
      TSX_TEXT_CONTEXT.test(line)
    );
  }
  if (extension === ".swift") {
    return literalHasEllipsis && SWIFT_UI_CONTEXT.test(line);
  }
  if (extension === ".rs") {
    return literalHasEllipsis && RUST_UI_CONTEXT.test(line);
  }
  return false;
}

function isGenericSubmit({ extension, line }) {
  const exactSubmit = quotedLiterals(line).some(
    (value) => value.trim() === "Submit",
  );
  if (extension === ".tsx") {
    return (
      />\s*Submit\s*</.test(line) ||
      (exactSubmit && TSX_LITERAL_CONTEXT.test(line))
    );
  }
  if (extension === ".swift") {
    return exactSubmit && /\bButton\s*\(/.test(line);
  }
  return false;
}

function isNativeSelect({ extension, line }) {
  return extension === ".tsx" && /<select\b/.test(line);
}

export const ACTIVE_RULES = Object.freeze([
  {
    id: "components/no-native-select",
    matches: isNativeSelect,
  },
  {
    id: "copy/no-ascii-ellipsis",
    matches: hasAsciiEllipsis,
  },
  {
    id: "copy/no-generic-submit",
    matches: isGenericSubmit,
  },
]);

export const FUTURE_RULE_IDS = Object.freeze([
  "copy/tasks-terminology",
  "fields/no-placeholder-only-label",
  "states/no-convincing-empty-on-error",
]);

export const SEMANTIC_EXCEPTIONS = Object.freeze([]);

export function isExcludedSource(relativePath, sourceRoot) {
  const normalized = relativePath.split(path.sep).join("/");
  if (/\.(?:test|spec)\.[^.]+$/.test(normalized)) return true;
  return sourceRoot.exclude.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}
```

`FUTURE_RULE_IDS` makes the approved activation sequence explicit without
pretending Phase 0 has migrated the terminology and state patterns those rules
will enforce.

### Step 4: Implement scanning, comparison, and the CLI

Create `scripts/ui-consistency.mjs` with:

```js
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVE_RULES,
  LIVE_SOURCE_ROOTS,
  SEMANTIC_EXCEPTIONS,
  isExcludedSource,
} from "./ui-consistency-policy.mjs";

function toPosix(value) {
  return value.split(path.sep).join("/");
}

export function normalizeExcerpt(line) {
  return line.trim().replace(/\s+/g, " ");
}

export function findingKey(finding) {
  return [finding.rule, finding.path, finding.excerpt].join("\u0000");
}

export function scanSource({ path: sourcePath, source }) {
  const extension = path.extname(sourcePath);
  const findings = [];
  for (const line of source.split(/\r?\n/)) {
    for (const rule of ACTIVE_RULES) {
      if (!rule.matches({ extension, line })) continue;
      findings.push({
        rule: rule.id,
        path: toPosix(sourcePath),
        excerpt: normalizeExcerpt(line),
      });
    }
  }
  return findings.sort((a, b) => findingKey(a).localeCompare(findingKey(b)));
}

function walk(directory, files = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === "target" ||
      entry.name === "gen" ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else files.push(fullPath);
  }
  return files;
}

export function scanRepository(repoRoot) {
  const findings = [];
  for (const sourceRoot of LIVE_SOURCE_ROOTS) {
    const absoluteRoot = path.join(repoRoot, sourceRoot.directory);
    for (const absolutePath of walk(absoluteRoot, [])) {
      const relativePath = toPosix(path.relative(repoRoot, absolutePath));
      if (isExcludedSource(relativePath, sourceRoot)) continue;
      if (!sourceRoot.extensions.includes(path.extname(relativePath))) continue;
      findings.push(
        ...scanSource({
          path: relativePath,
          source: readFileSync(absolutePath, "utf8"),
        }),
      );
    }
  }
  return findings.sort((a, b) => findingKey(a).localeCompare(findingKey(b)));
}

function duplicateKeys(findings) {
  const seen = new Set();
  const duplicates = new Set();
  for (const finding of findings) {
    const key = findingKey(finding);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates].sort();
}

export function compareFindings(findings, baselineFindings, exceptions) {
  const invalidExceptions = exceptions.filter(
    (exception) => !exception.reason?.trim(),
  );
  const validExceptions = exceptions.filter(
    (exception) => exception.reason?.trim(),
  );
  const liveKeys = new Set(findings.map(findingKey));
  const exceptionKeys = new Set(validExceptions.map(findingKey));
  const activeFindings = findings.filter(
    (finding) => !exceptionKeys.has(findingKey(finding)),
  );
  const activeKeys = new Set(activeFindings.map(findingKey));
  const baselineKeys = new Set(baselineFindings.map(findingKey));
  const newFindings = activeFindings.filter(
    (finding) => !baselineKeys.has(findingKey(finding)),
  );
  const resolvedBaseline = baselineFindings.filter(
    (finding) => !activeKeys.has(findingKey(finding)),
  );
  const staleExceptions = validExceptions.filter(
    (exception) => !liveKeys.has(findingKey(exception)),
  );
  const duplicateBaselineKeys = duplicateKeys(baselineFindings);

  return {
    ok:
      newFindings.length === 0 &&
      resolvedBaseline.length === 0 &&
      staleExceptions.length === 0 &&
      invalidExceptions.length === 0 &&
      duplicateBaselineKeys.length === 0,
    activeFindings,
    newFindings,
    resolvedBaseline,
    staleExceptions,
    invalidExceptions,
    duplicateBaselineKeys,
  };
}

export function readBaseline(filePath) {
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (parsed.version !== 1 || !Array.isArray(parsed.findings)) {
    throw new Error("UI consistency baseline must have version 1 and a findings array.");
  }
  return parsed;
}

function printFindings(title, findings) {
  if (!findings.length) return;
  console.error(`\n${title}:`);
  for (const finding of findings) {
    console.error(`  ${finding.rule} · ${finding.path} · ${finding.excerpt}`);
  }
}

function runCli() {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const baseline = readBaseline(
    path.join(repoRoot, "scripts/ui-consistency-baseline.json"),
  );
  const findings = scanRepository(repoRoot);
  const result = compareFindings(
    findings,
    baseline.findings,
    SEMANTIC_EXCEPTIONS,
  );

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ inventory: baseline.inventory, findings, result }, null, 2));
  } else if (result.ok) {
    console.log(
      `✓ UI consistency baseline matches ${result.activeFindings.length} finding(s); ` +
        `${SEMANTIC_EXCEPTIONS.length} semantic exception(s)`,
    );
  } else {
    printFindings("New findings", result.newFindings);
    printFindings("Resolved baseline entries that must be removed", result.resolvedBaseline);
    printFindings("Stale semantic exceptions", result.staleExceptions);
    printFindings("Semantic exceptions without reasons", result.invalidExceptions);
    if (result.duplicateBaselineKeys.length) {
      console.error("\nDuplicate baseline keys:");
      for (const key of result.duplicateBaselineKeys) console.error(`  ${key}`);
    }
    process.exitCode = 1;
  }
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) runCli();
```

### Step 5: Run the seeded scanner tests

Run:

```bash
node scripts/ui-consistency.test.mjs
```

Expected: `ui-consistency.test.mjs: scanner unit cases ok`.

### Step 6: Commit the scanner engine

Run:

```bash
git add scripts/ui-consistency-policy.mjs scripts/ui-consistency.mjs scripts/ui-consistency.test.mjs
git diff --cached --check
git commit -S -m "test(ui): add consistency scanner engine"
```

Expected: a signed commit containing the policy, engine, and seeded unit cases.

## Task 5: Bootstrap and wire the reviewed debt baseline

**Files:**

- Create: `scripts/ui-consistency-baseline.json`
- Modify: `scripts/ui-consistency.test.mjs`
- Modify: `package.json:14-27`

### Step 1: Add the failing repository-integration assertion

Add these imports to `scripts/ui-consistency.test.mjs`:

```js
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareFindings,
  readBaseline,
  scanRepository,
  scanSource,
} from "./ui-consistency.mjs";
import { SEMANTIC_EXCEPTIONS } from "./ui-consistency-policy.mjs";
```

Replace the earlier `compareFindings` / `scanSource` import with the block
above, then append this before the final log:

```js
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const baseline = readBaseline(
  path.join(repoRoot, "scripts/ui-consistency-baseline.json"),
);
const repositoryResult = compareFindings(
  scanRepository(repoRoot),
  baseline.findings,
  SEMANTIC_EXCEPTIONS,
);
assert.equal(
  repositoryResult.ok,
  true,
  JSON.stringify(
    {
      newFindings: repositoryResult.newFindings,
      resolvedBaseline: repositoryResult.resolvedBaseline,
      staleExceptions: repositoryResult.staleExceptions,
      invalidExceptions: repositoryResult.invalidExceptions,
      duplicateBaselineKeys: repositoryResult.duplicateBaselineKeys,
    },
    null,
    2,
  ),
);
```

Change the final log to:

```js
console.log("ui-consistency.test.mjs: contract, scanner, and baseline ok");
```

### Step 2: Run the test and verify it fails on the absent baseline

Run:

```bash
node scripts/ui-consistency.test.mjs
```

Expected: FAIL with `ENOENT` for
`scripts/ui-consistency-baseline.json`.

### Step 3: Add the audited starting inventory and exact debt

Create `scripts/ui-consistency-baseline.json` with:

```json
{
  "version": 1,
  "sourceRevision": "41cca0ce",
  "inventory": {
    "reactTsxFiles": 260,
    "nativeIosSwiftFiles": 73,
    "reactPlaceholderAssignments": 148,
    "sharedPrimitiveUses": {
      "Button": 261,
      "IconButton": 31,
      "SearchInput": 6,
      "StandardSelect": 36,
      "EmptyState": 60,
      "ErrorState": 6
    }
  },
  "findings": [
    {
      "rule": "components/no-native-select",
      "path": "src/components/role-surfaces/messenger-surface.tsx",
      "excerpt": "<select"
    },
    {
      "rule": "components/no-native-select",
      "path": "src/components/role-surfaces/messenger-surface.tsx",
      "excerpt": "<select value={selected.tone} onChange={(e) => updateSelected({ tone: e.target.value })}>"
    },
    {
      "rule": "components/no-native-select",
      "path": "src/components/settings-profile.tsx",
      "excerpt": "<select"
    },
    {
      "rule": "components/no-native-select",
      "path": "src/components/stitch-intake.tsx",
      "excerpt": "<select"
    },
    {
      "rule": "copy/no-ascii-ellipsis",
      "path": "src/components/board-view.tsx",
      "excerpt": "{ value: \"\", label: \"Assign to...\", disabled: true },"
    },
    {
      "rule": "copy/no-ascii-ellipsis",
      "path": "src/components/board-view.tsx",
      "excerpt": "{ value: \"\", label: \"Move to...\", disabled: true },"
    },
    {
      "rule": "copy/no-ascii-ellipsis",
      "path": "src/components/board-view.tsx",
      "excerpt": "{ value: \"\", label: \"Priority...\", disabled: true },"
    },
    {
      "rule": "copy/no-ascii-ellipsis",
      "path": "src/components/board-view.tsx",
      "excerpt": "placeholder=\"Assign to...\""
    },
    {
      "rule": "copy/no-ascii-ellipsis",
      "path": "src/components/board-view.tsx",
      "excerpt": "placeholder=\"Move to...\""
    },
    {
      "rule": "copy/no-ascii-ellipsis",
      "path": "src/components/board-view.tsx",
      "excerpt": "placeholder=\"Priority...\""
    },
    {
      "rule": "copy/no-ascii-ellipsis",
      "path": "src/components/command-palette.tsx",
      "excerpt": "<span>Asking Salem through salem.opencoven.ai...</span>"
    },
    {
      "rule": "copy/no-ascii-ellipsis",
      "path": "src/components/familiar-chatout-codex/FamiliarChatoutCodexSurface.tsx",
      "excerpt": "<div className={styles.sidebarProject}><span>macOS Application Pri...</span><span>5d</span></div>"
    },
    {
      "rule": "copy/no-ascii-ellipsis",
      "path": "src/components/familiar-chatout-codex/FamiliarChatoutCodexSurface.tsx",
      "excerpt": "<span>create a Codex-style famil...</span>"
    },
    {
      "rule": "copy/no-ascii-ellipsis",
      "path": "src/components/familiar-menu-bar.tsx",
      "excerpt": "placeholder=\"Search or ask Salem...\""
    },
    {
      "rule": "copy/no-ascii-ellipsis",
      "path": "src/components/familiar-studio-brain-tab.tsx",
      "excerpt": "...(allowCustomModel ? [{ value: \"__custom__\", label: \"Custom...\" }] : []),"
    },
    {
      "rule": "copy/no-ascii-ellipsis",
      "path": "src/components/familiars-memory-view.tsx",
      "excerpt": "placeholder={lockToFamiliar && selectedFamiliar?.display_name ? `Search ${selectedFamiliar.display_name}'s memory...` : \"Search memory...\"}"
    },
    {
      "rule": "copy/no-ascii-ellipsis",
      "path": "src/components/top-bar.tsx",
      "excerpt": "placeholder=\"Search or ask Salem...\""
    }
  ]
}
```

This baseline is intentionally debt, not an exception list. Later migration
PRs delete entries as they fix the source. Do not add a baseline writer command.

### Step 4: Expose the explicit check command

Add this script immediately after `check:tests-wired` in `package.json`:

```json
"check:ui-consistency": "node scripts/ui-consistency.mjs",
```

### Step 5: Run the baseline and wiring checks

Run:

```bash
node scripts/ui-consistency.test.mjs
pnpm check:ui-consistency
pnpm check:tests-wired
```

Expected:

```text
ui-consistency.test.mjs: contract, scanner, and baseline ok
✓ UI consistency baseline matches 17 finding(s); 0 semantic exception(s)
```

The wiring guard must also exit 0.

If the repository scan reports a different finding set, inspect each source
line and the scanner rule. Correct the rule if it produced a false positive;
otherwise update the reviewed JSON to the exact current finding. Never silence
a real finding by weakening the rule or adding an unexplained exception.

### Step 6: Commit the baseline and command

Run:

```bash
git add scripts/ui-consistency-baseline.json scripts/ui-consistency.test.mjs package.json
git diff --cached --check
git commit -S -m "test(ui): enforce reviewed consistency baseline"
```

Expected: a signed commit with the audited baseline, repository integration
assertion, and package command.

## Task 6: Rebase, run full gates, and inspect the real reference page

**Files:**

- Verify all Phase 0 files
- Temporarily create and delete:
  `.worktrees/run-ui-xd1b1-019f4a47/__verify-aesthetic.mjs`

### Step 1: Reconcile with current `origin/main`

Run from the feature worktree:

```bash
git fetch origin main
git rebase -S origin/main
git status --short --branch
```

Expected: rebase succeeds, the branch is clean, and it remains ahead of
`origin/main` only by the signed program-spec, plan, and Phase 0 commits.

If a conflict touches an active Beads-owned change, stop and inspect ownership
before resolving it.

### Step 2: Run focused and repository-wide verification

Run:

```bash
node scripts/ui-consistency.test.mjs
node --experimental-strip-types src/components/ui/field.test.ts
node --experimental-strip-types src/app/aesthetic/aesthetic-fields.test.ts
pnpm check:ui-consistency
pnpm check:tests-wired
pnpm typecheck
pnpm test
git diff --check
```

Expected:

- all three focused tests print their `ok` messages;
- the consistency and wiring checks exit 0;
- TypeScript exits 0;
- `594 test file(s) passed [app]`;
- `git diff --check` prints nothing.

### Step 3: Create a fail-fast verification worktree at the feature HEAD

Run:

```bash
MAIN=/Users/buns/Documents/GitHub/OpenCoven/coven-cave
FEATURE=/Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/feat-ui-consistency-program
VERIFY=/Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/run-ui-xd1b1-019f4a47
git -C "$MAIN" worktree prune
test ! -e "$VERIFY"
SHA=$(git -C "$FEATURE" rev-parse HEAD)
git -C "$MAIN" worktree add --detach "$VERIFY" "$SHA"
git -C "$VERIFY" rev-parse --short HEAD
pnpm --dir "$VERIFY" install --frozen-lockfile
pnpm --dir "$VERIFY" build
```

Expected: the path was free, the detached worktree is at the feature SHA,
dependency installation exits 0, and the production build exits 0.

### Step 4: Add the temporary Playwright verifier with `apply_patch`

Create `__verify-aesthetic.mjs` in the verification worktree:

```js
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const port = process.env.PORT;
assert.ok(port, "PORT is required");
const baseUrl = `http://127.0.0.1:${port}/aesthetic`;
const browser = await chromium.launch();

const desktop = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
});
const page = await desktop.newPage();
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "Fields" }).waitFor();

const project = page.getByLabel("Project name");
const projectId = await project.getAttribute("id");
assert.ok(projectId, "Project name has a generated id");
assert.equal(
  await page.locator(`label[for="${projectId}"]`).count(),
  1,
  "Project name has one persistent associated label",
);
assert.equal(await project.getAttribute("required"), "", "required reaches the native input");

const repository = page.getByLabel("Repository path");
assert.equal(await repository.getAttribute("aria-invalid"), "true");
const describedBy = (await repository.getAttribute("aria-describedby")) ?? "";
const error = page.getByRole("alert", { name: "Enter an absolute project path" });
await error.waitFor();
const errorId = await error.getAttribute("id");
assert.ok(errorId && describedBy.split(/\s+/).includes(errorId));

await project.focus();
const outline = await project.evaluate((element) => {
  const style = getComputedStyle(element);
  return { style: style.outlineStyle, width: style.outlineWidth };
});
assert.notEqual(outline.style, "none", "keyboard focus is visible");
assert.notEqual(outline.width, "0px", "keyboard focus has width");

await page.screenshot({ path: "/tmp/cave-ui-fields-dark.png", fullPage: true });
await page.evaluate(() => {
  document.documentElement.dataset.mode = "light";
});
await page.screenshot({ path: "/tmp/cave-ui-fields-light.png", fullPage: true });
await page.evaluate(() => {
  document.documentElement.dataset.mode = "dark";
  document.documentElement.dataset.theme = "grove";
});
await page.screenshot({ path: "/tmp/cave-ui-fields-grove.png", fullPage: true });
await desktop.close();

const touch = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const touchPage = await touch.newPage();
await touchPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
await touchPage.getByRole("heading", { name: "Fields" }).waitFor();
const touchFontSize = await touchPage
  .getByLabel("Project name")
  .evaluate((element) => getComputedStyle(element).fontSize);
assert.equal(touchFontSize, "16px", "coarse-pointer fields prevent iOS zoom");
await touchPage.screenshot({ path: "/tmp/cave-ui-fields-touch.png", fullPage: true });
await touch.close();

const reduced = await browser.newContext({
  viewport: { width: 900, height: 800 },
  reducedMotion: "reduce",
});
const reducedPage = await reduced.newPage();
await reducedPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
await reducedPage.getByRole("heading", { name: "Fields" }).waitFor();
const transitionMs = await reducedPage
  .getByLabel("Project name")
  .evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration) * 1000);
assert.ok(transitionMs <= 0.01, `reduced motion transition was ${transitionMs}ms`);
await reduced.close();

await browser.close();
console.log("aesthetic runtime verification: ok");
```

### Step 5: Run the production server and verifier in one attached shell

Run from the verification worktree:

```bash
PORT=35741
while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done
rm -rf .next/dev
PORT="$PORT" node server.mjs > /tmp/cave-run-ui-xd1b1-019f4a47.log 2>&1 &
SERVER_PID=$!
until curl -s -m3 -o /dev/null "http://127.0.0.1:$PORT/aesthetic"; do
  sleep 2
done
PORT="$PORT" node __verify-aesthetic.mjs
kill "$SERVER_PID"
wait "$SERVER_PID" || true
```

Expected: `aesthetic runtime verification: ok`.

Open all four screenshots with the image-viewing tool. Confirm:

- labels, help, and errors form one clear vertical rhythm;
- invalid, read-only, and disabled states remain distinct in dark, light, and
  Grove;
- the touch layout does not clip or horizontally overflow;
- placeholder contrast is clearly secondary without becoming illegible;
- only the invalid field uses danger emphasis.

If a screenshot contradicts any point, fix the implementation test-first,
commit the repair, rebuild the verification worktree at the new feature HEAD,
and repeat this runtime step.

### Step 6: Delete only the temporary verifier and worktree

Delete `__verify-aesthetic.mjs` with `apply_patch`, then run:

```bash
MAIN=/Users/buns/Documents/GitHub/OpenCoven/coven-cave
VERIFY=/Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/run-ui-xd1b1-019f4a47
git -C "$MAIN" worktree remove --force "$VERIFY"
git -C "$MAIN" worktree prune
git -C "$MAIN" worktree list
```

Expected: only the verification worktree disappears. The feature worktree and
all unrelated worktrees remain.

## Task 7: Publish, merge, and hand Phase 0 back to the umbrella

**Files:**

- Update Beads: `cave-xd1b.1` and `cave-xd1b`
- Publish the current branch through a protected GitHub PR

### Step 1: Re-check ownership and duplicate work immediately before publishing

Run:

```bash
bd show cave-xd1b.1 --json
gh api "repos/OpenCoven/coven-cave/pulls?state=all&per_page=100" --jq '.[] | select((.title | ascii_downcase | test("ui consistency|field primitives|copy contract"))) | [.number,.state,.head.ref,.title] | @tsv'
git status --short --branch
git log --show-signature --oneline origin/main..HEAD
```

Expected: `cave-xd1b.1` is still owned by this session, no overlapping PR
exists, the worktree is clean, and all branch commits are signed.

### Step 2: Record verification evidence in the child bead

Append a note that names:

- branch `feat/ui-consistency-program`;
- worktree `.worktrees/feat-ui-consistency-program`;
- current Codex thread;
- focused test outputs;
- `pnpm check:ui-consistency`;
- `pnpm check:tests-wired`;
- `pnpm typecheck`;
- `594/594` app test files;
- production build;
- four inspected screenshot paths and their dark/light/Grove/touch results.

Use:

```bash
EVIDENCE="VERIFIED Phase 0 on branch feat/ui-consistency-program in .worktrees/feat-ui-consistency-program; owner Codex thread 019f4a47-2606-7672-a79a-39c5fbde2331. Focused contracts passed: node scripts/ui-consistency.test.mjs, node src/components/ui/field.test.ts, node src/app/aesthetic/aesthetic-fields.test.ts. Gates passed: pnpm check:ui-consistency with 17 reviewed baseline findings and 0 semantic exceptions; pnpm check:tests-wired; pnpm typecheck; pnpm test with 594/594 app test files; pnpm build. Browser verification passed in dark, light, Grove, and touch viewports; labels/help/errors, invalid/read-only/disabled contrast, no touch overflow, placeholder hierarchy, keyboard focus, accessible descriptions, and reduced motion were inspected in /tmp/cave-ui-fields-dark.png, /tmp/cave-ui-fields-light.png, /tmp/cave-ui-fields-grove.png, and /tmp/cave-ui-fields-touch.png."
bd update cave-xd1b.1 --append-notes "$EVIDENCE" --json
```

Run this command only after the named outputs and visual checks have been
observed. If any count or result differs, edit the evidence to report the
observed result accurately before updating the Bead.

### Step 3: Push and open the Phase 0 PR

Run:

```bash
git push -u origin feat/ui-consistency-program
gh pr create --draft --base main --head feat/ui-consistency-program --title "feat(ui): establish consistency foundation" --body "## Summary
- codifies the cross-platform UI copy and placeholder contract
- adds accessible Field, TextInput, and TextArea primitives
- documents every field state on /aesthetic
- adds a reviewed, progressively shrinking consistency baseline

## Tracking
- cave-xd1b.1

## Verification
- pnpm check:ui-consistency
- pnpm check:tests-wired
- pnpm typecheck
- pnpm test
- pnpm build
- real-browser dark/light/Grove/touch/a11y/reduced-motion checks"
gh pr ready
```

Expected: the remote branch exists and the PR is ready for review.

### Step 4: Address review findings and re-run affected gates

For every actionable review comment:

1. verify the claim against current source;
2. add or adjust a failing test;
3. implement the smallest correct change;
4. run the focused test and all affected gates;
5. commit signed and push.

Do not weaken scanner rules or baseline comparison merely to satisfy a check.

### Step 5: Merge only after all required checks are green

Run:

```bash
PR_NUMBER=$(gh pr view --json number -q .number)
gh pr checks "$PR_NUMBER" --watch --interval 20
git fetch origin main
git rebase -S origin/main
node scripts/ui-consistency.test.mjs
node src/components/ui/field.test.ts
node src/app/aesthetic/aesthetic-fields.test.ts
pnpm check:ui-consistency
pnpm check:tests-wired
pnpm typecheck
pnpm test
pnpm build
git push --force-with-lease
gh pr checks "$PR_NUMBER" --watch --interval 20
gh pr merge "$PR_NUMBER" --squash --delete-branch
```

Because this repository reports duplicate push and pull-request checks on the
same SHA, confirm there are no pending required contexts immediately before the
merge. If the rebase resolves a conflict or changes any Phase 0 source file,
repeat Task 6's real-browser verification before pushing. If GraphQL quota is
exhausted, use the documented REST fallbacks from the project memory.

### Step 6: Verify the merge before any cleanup

Run these as separate commands:

```bash
PR_NUMBER=$(gh pr view --json number -q .number)
git fetch origin main
git log origin/main --oneline -10
git log origin/main --oneline -10 | rg "feat\(ui\): establish consistency foundation \(#${PR_NUMBER}\)"
```

Expected: the final command prints the merged Phase 0 commit with the actual PR
number and exits zero.

Do not close the bead or remove the worktree unless this inline history check
proves the merge.

### Step 7: Close the child, update the umbrella, and remove only this worktree

After verified merge:

```bash
bd close cave-xd1b.1 --reason "Phase 0 merged and verified on origin/main"
bd update cave-xd1b --append-notes "Phase 0 cave-xd1b.1 merged: copy contract, field primitives, aesthetic reference, and conformance baseline. Umbrella remains open for React migrations, iOS, Tauri, and closure audit." --json
WT_GUARD_BYPASS=1 git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave worktree remove /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/feat-ui-consistency-program
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave worktree prune
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave branch -D feat/ui-consistency-program
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave status --short --branch
```

Expected: the Phase 0 child is closed, `cave-xd1b` remains open/unassigned,
the Phase 0 worktree and local transport branch are gone, and unrelated
primary-checkout changes are reported without modification.

## Plan self-review

### Phase 0 specification coverage

- Copy contract: Task 1.
- Field semantics, IDs, help/error wiring, optional/required state, refs, and
  token styles: Task 2.
- Default, described, optional, required, invalid, disabled, read-only, and
  multiline reference states: Task 3.
- Deterministic live-root scanner, seeded failures, drift comparison,
  reasoned exceptions, and stale-entry rejection: Tasks 4-5.
- Starting inventory and reviewed debt: Task 5.
- Wiring, typecheck, full suite, themes, narrow/touch, keyboard,
  screen-reader semantics, reduced motion, and production build: Task 6.
- Branch/Beads/PR/merge evidence: Task 7.

Later React migrations, iOS, Tauri, and final completion proof remain correctly
outside this bounded plan and inside the open umbrella.

### Type and name consistency

- `FieldControlProps` is defined in `field.tsx` and consumed by
  `useFieldControlProps`, `TextInput`, and `TextArea`.
- CSS names are consistently `ui-field__*`, `ui-text-input`, and
  `ui-text-area`.
- Scanner APIs remain `scanSource`, `scanRepository`, `compareFindings`,
  and `readBaseline` in code and tests.
- Baseline keys consistently use `rule`, `path`, and normalized `excerpt`.
- Active Phase 0 rules and future rule IDs match the approved program design.
