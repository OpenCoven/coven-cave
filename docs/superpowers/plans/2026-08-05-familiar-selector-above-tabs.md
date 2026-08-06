# Familiar Selector and Reference-Style Home Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move familiar context above the Home and Chat controls, and make the Home / New chat composer emulate the supplied reference while retaining its current capabilities.

**Architecture:** Reuse `FamiliarQuickSwitch`, `ComposerPlusMenu`, `ComposerContextChips`, and the shared `Popover` primitives. `HomeComposer` owns the reference-style composition and retains its existing destination, project, model, Enhance, dictation, and send state. `ChatSurface` adds the same shared familiar context row above its unchanged section tabs.

**Tech Stack:** React, TypeScript, Tailwind utility classes, token-based CSS, Node source-contract tests.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/components/composer-plus-menu.tsx` | Allow the existing tools menu to render its trigger with a Home-specific text label while preserving its menu behavior. |
| `src/components/home-composer.tsx` | Compose the Home-only reference shell, destination menu, familiar context row, and existing controls. |
| `src/components/chat-surface.tsx` | Render the shared familiar context row above existing Chat tabs. |
| `src/styles/home-composer/landing-composer.css` | Token-based Home reference shell, control placement, and narrow-width layout. |
| `src/styles/cave-chat/auxiliary-surfaces.css` | Token-based full-width Chat familiar context row. |
| `src/components/home-composer.test.ts` | Assert Home behavior, menu wiring, and preserved send/context contracts. |
| `src/components/home-composer-polish.test.ts` | Assert the Home reference layout hierarchy and responsive CSS hooks. |
| `src/components/chat-surface.test.ts` | Assert Chat familiar context placement and active-familiar wiring. |
| `src/components/chat-surface-mobile-command-center.test.ts` | Retain the sticky, touch-sized Chat tab-row contract. |

### Task 1: Replace obsolete layout contracts with the approved reference contract

**Files:**
- Modify: `src/components/home-composer.test.ts`
- Modify: `src/components/home-composer-polish.test.ts`
- Modify: `src/components/chat-surface.test.ts`

- [ ] **Step 1: Add failing Home behavior assertions**

  In `home-composer.test.ts`, assert the reference shell owns a labeled Tools
  trigger, a menu-backed destination trigger, and the existing destination
  values:

  ```ts
  assert.match(
    source,
    /<ComposerPlusMenu[\s\S]*?triggerLabel="Tools"/,
    "Home presents the existing actions menu through the reference-style Tools trigger",
  );
  assert.match(
    source,
    /<Popover[\s\S]*?ariaLabel="Choose destination"[\s\S]*?DESTINATIONS\.map\(\(item\) => \([\s\S]*?setDestination\(item\.id\)/,
    "Home chooses the existing Chat or Task destination through a menu",
  );
  assert.doesNotMatch(
    source,
    /hc-dest-pills hc-dest-pills--inline/,
    "the reference-style destination menu replaces the visible Chat/Task tab pair",
  );
  ```

- [ ] **Step 2: Add failing Home hierarchy and accessibility assertions**

  In `home-composer-polish.test.ts`, assert the selector is in a dedicated
  `home-composer-familiar-context` row above the composer shell, that the
  toolbar no longer contains it, and that the edge controls use named buttons:

  ```ts
  assert.match(
    source,
    /home-composer-familiar-context[\s\S]*?<FamiliarQuickSwitch[\s\S]*?home-composer-reference-shell/,
    "Home establishes familiar context before the reference-style composer",
  );
  assert.doesNotMatch(
    source,
    /home-composer-toolbar__left[\s\S]*?<FamiliarQuickSwitch/,
    "the footer context cluster no longer owns familiar selection",
  );
  assert.match(
    source,
    /aria-label="Choose destination"[\s\S]*?aria-label="Send"/,
    "the destination control remains textual and the existing send control remains available",
  );
  ```

  Update obsolete assertions that require the old inline `hc-dest-pills`
  structure. Retain assertions for the current `ComposerContextChips`, options
  menu, attachment staging, Enhance state, and send behavior.

- [ ] **Step 3: Add failing Chat hierarchy assertions**

  In `chat-surface.test.ts`, replace the old no-header-selector assertion with
  one structural assertion that proves the same
  `.chat-familiar-context` block contains `FamiliarQuickSwitch`,
  `activeFamiliarId={activeFamiliarId}`, a guarded
  `onSetActiveFamiliar(id)` callback, `labeled`, and `singleRequired`, then
  closes before the existing `chat-scope-tabs chat-scope-tabs--minimal` block.

- [ ] **Step 4: Run the changed contracts to confirm they fail**

  Run:

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/home-composer.test.ts
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/home-composer-polish.test.ts
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/chat-surface.test.ts
  ```

  Expected: failures identify the missing reference shell, menu-backed
  destination control, and Chat familiar context row.

### Task 2: Make the shared actions menu support the reference Tools trigger

**Files:**
- Modify: `src/components/composer-plus-menu.tsx`
- Modify: `src/styles/home-composer/landing-composer.css`
- Test: `src/components/home-composer.test.ts`

- [ ] **Step 1: Add a backwards-compatible trigger label prop**

  Add an optional `triggerLabel?: string` property to `ComposerPlusMenu` and
  render text instead of the `ph:plus` icon only when it is present:

  ```tsx
  <button
    ref={anchorRef}
    type="button"
    className={`cave-composer-plus focus-ring${triggerLabel ? " cave-composer-plus--labeled" : ""}`}
    disabled={disabled}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={triggerLabel ?? "Composer actions"}
    title={triggerLabel ?? "Attach, projects, skills, and tuning"}
    onClick={() => setOpen((v) => !v)}
  >
    {triggerLabel ? <span>{triggerLabel}</span> : <Icon name="ph:plus" width={15} aria-hidden />}
  </button>
  ```

  Leave callers without `triggerLabel` unchanged so their current plus-button
  UI and accessible name remain intact.

- [ ] **Step 2: Add the labeled trigger token styles**

  Add a `.cave-composer-plus--labeled` rule in the Home stylesheet that uses
  `--radius-control`, `--space-*`, `--border-hairline`, `--bg-raised`, and the
  existing mono label register. Scope it beneath
  `.home-composer-reference-shell` so the shared plus-button size remains
  unchanged outside Home.

- [ ] **Step 3: Run the Home behavior test**

  Run:

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/home-composer.test.ts
  ```

  Expected: the Tools-trigger assertion passes while unrelated Home contracts
  still pass.

### Task 3: Build the Home-only reference shell without changing behavior

**Files:**
- Modify: `src/components/home-composer.tsx`
- Modify: `src/styles/home-composer/landing-composer.css`
- Test: `src/components/home-composer.test.ts`
- Test: `src/components/home-composer-polish.test.ts`

- [ ] **Step 1: Add destination-menu state and anchor**

  Add a `destinationMenuOpen` boolean state and
  `destinationMenuRef` button ref beside the existing `optionsOpen` and
  `plusAnchorRef` state:

  ```ts
  const [destinationMenuOpen, setDestinationMenuOpen] = useState(false);
  const destinationMenuRef = useRef<HTMLButtonElement | null>(null);
  ```

- [ ] **Step 2: Move the familiar selector above the composer**

  Remove the existing `FamiliarQuickSwitch` from
  `.home-composer-toolbar__left`. Insert the same configured switcher in a
  `home-composer-familiar-context` row directly before the new
  `home-composer-reference-shell`. Keep `singleRequired`, `labeled`, current
  familiar data, session data, and `onSetActiveFamiliar` wiring unchanged.

- [ ] **Step 3: Replace the inline destination tabs with the menu-backed edge control**

  Within `home-composer-reference-shell`, render the existing
  `ComposerPlusMenu` with `triggerLabel="Tools"` in the upper-left cluster.
  Render this upper-right destination trigger and menu:

  ```tsx
  <button
    ref={destinationMenuRef}
    type="button"
    className="home-composer-destination-trigger focus-ring"
    aria-haspopup="menu"
    aria-expanded={destinationMenuOpen}
    aria-label="Choose destination"
    onClick={() => setDestinationMenuOpen((open) => !open)}
  >
    <Icon name={DESTINATIONS.find((item) => item.id === destination)?.icon ?? "ph:chat-circle-dots"} width={14} aria-hidden />
    {DESTINATIONS.find((item) => item.id === destination)?.label}
  </button>
  <Popover
    open={destinationMenuOpen}
    onOpenChange={setDestinationMenuOpen}
    anchorRef={destinationMenuRef}
    placement="bottom-end"
    minWidth={168}
    ariaLabel="Choose destination"
  >
    <PopoverBody role="menu" ariaLabel="Choose destination">
      {DESTINATIONS.map((item) => (
        <PopoverItem
          key={item.id}
          icon={item.icon}
          selected={destination === item.id}
          onSelect={() => {
            setDestination(item.id);
            setDestinationMenuOpen(false);
          }}
        >
          {item.label}
        </PopoverItem>
      ))}
    </PopoverBody>
  </Popover>
  ```

  Import `PopoverItem` with the existing `Popover` and `PopoverBody` import.
  Retain the existing `destination` values and submit branches unchanged.

- [ ] **Step 4: Recompose lower controls around existing behavior**

  Keep the textarea, attachment staging, slash menu, Enhance strip,
  `ComposerOptionsMenu`, `ComposerContextChips`, send button, and their
  handlers. Place the project/model context cluster in the lower-left area;
  place existing Enhance and dictation controls in the lower-right only when
  their existing availability/disabled conditions allow them. Preserve the
  current send button and its `aria-label="Send"` in that cluster.

- [ ] **Step 5: Add responsive token-based CSS**

  Add scoped Home rules for:

  ```css
  .home-composer-familiar-context { display: flex; min-width: 0; padding: var(--space-2) var(--space-3) 0; }
  .home-composer-familiar-context .familiar-quickswitch,
  .home-composer-familiar-context .familiar-switcher__trigger--labeled { width: 100%; max-width: none; }
  .home-composer-reference-shell { position: relative; display: grid; gap: var(--space-3); min-height: 13rem; }
  ```

  Use a narrow container query to stack lower controls and apply
  `min-height: var(--touch-target)` to every edge action. Use only existing
  tokens for colors, spacing, radii, typography, borders, and motion.

- [ ] **Step 6: Run focused Home tests**

  Run:

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/home-composer.test.ts
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/home-composer-polish.test.ts
  ```

  Expected: each test reports its success message.

### Task 4: Add the Chat familiar context row above unchanged section tabs

**Files:**
- Modify: `src/components/chat-surface.tsx`
- Modify: `src/styles/cave-chat/auxiliary-surfaces.css`
- Test: `src/components/chat-surface.test.ts`
- Test: `src/components/chat-surface-mobile-command-center.test.ts`

- [ ] **Step 1: Import and render the shared selector**

  Import `FamiliarQuickSwitch`. Wrap the existing tab header in a
  `chat-scope-header` container whose first child is:

  ```tsx
  <div className="chat-familiar-context">
    <FamiliarQuickSwitch
      familiars={resolvedFamiliars}
      activeFamiliarId={activeFamiliarId}
      selectedFamiliarIds={selectedFamiliarIds}
      sessions={sessions}
      onSelectFamiliar={(id) => {
        if (id) onSetActiveFamiliar(id);
      }}
      labeled
      singleRequired
    />
  </div>
  ```

  Make the existing `chat-scope-tabs chat-scope-tabs--minimal` row the second
  child. Do not alter its `Tabs`, Group, or mobile code-rail controls.

- [ ] **Step 2: Add scoped Chat row CSS**

  Add this layout in `auxiliary-surfaces.css`:

  ```css
  .chat-familiar-context {
    display: flex;
    min-width: 0;
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--border-hairline);
  }

  .chat-familiar-context .familiar-quickswitch,
  .chat-familiar-context .familiar-switcher__trigger--labeled {
    width: 100%;
    max-width: none;
  }
  ```

  Avoid a double divider by assigning the header boundary to only one of the
  context and tab rows. Preserve the existing mobile sticky selector and
  `top: 0` rule for `.chat-scope-tabs`.

- [ ] **Step 3: Run focused Chat tests**

  Run:

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/chat-surface.test.ts
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/chat-surface-mobile-command-center.test.ts
  ```

  Expected: each test reports its success message, including the sticky,
  touch-sized mobile tab-row contract.

### Task 5: Verify the complete Home and Chat change

**Files:**
- Test: `src/components/home-composer.test.ts`
- Test: `src/components/home-composer-polish.test.ts`
- Test: `src/components/chat-surface.test.ts`
- Test: `src/components/chat-surface-mobile-command-center.test.ts`

- [ ] **Step 1: Run all focused contracts**

  Run:

  ```bash
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/home-composer.test.ts
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/home-composer-polish.test.ts
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/chat-surface.test.ts
  node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/chat-surface-mobile-command-center.test.ts
  ```

  Expected: every command exits 0.

- [ ] **Step 2: Run static validation**

  Run:

  ```bash
  pnpm typecheck
  pnpm lint
  ```

  Expected: both commands exit 0.

- [ ] **Step 3: Inspect Home and Chat in the desktop shell**

  Run `bash scripts/dev-app.sh`. On Home, verify the full-width familiar
  selector, outlined reference shell, Tools menu, destination menu, context
  controls, Enhance, dictation, and send button. On Chat, verify the selector
  precedes the section tabs. At a narrow width, verify Home edge controls keep
  touch targets and Chat’s section tabs remain sticky and horizontally
  reachable.

**Commit policy:** This repository’s conservative Beads profile requires
current user authorization before committing or pushing. Leave commits and
pushes to the user unless that authorization is explicitly granted.
