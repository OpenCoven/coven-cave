# Cross-platform UI consistency program design

**Status:** Architecture approved on 2026-07-09; written specification awaiting review.

**Bead:** `cave-xd1b`

## Objective

Make Coven Cave feel like one product across its React/Tauri application,
native iOS application, and desktop-system surfaces. Standardize components and
user-facing language—including labels, actions, help text, placeholders,
loading states, empty states, errors, and recovery guidance—without flattening
the product's existing Coven identity or replacing platform-native interaction
patterns with web imitations.

This is a migration program, not a single broad rewrite. It establishes an
enforceable foundation, moves each user-facing surface onto that foundation in
bounded phases, and finishes with a cross-platform completion audit.

## Evidence and problem statement

The source audit was taken from clean `origin/main` at `41cca0ce` after PR
`#2907` merged. It found:

- 260 React TSX source files and 73 native iOS Swift source files;
- 148 React placeholder assignments;
- four remaining native HTML `<select>` elements outside the shared select
  primitive;
- six literal placeholders using ASCII three-dot ellipses instead of `…`;
- mature shared primitives for buttons, selection, modals, popovers, tabs,
  empty states, errors, skeletons, and live announcements, but uneven adoption;
- 60 `EmptyState` uses versus only six `ErrorState` uses, alongside many bare
  loading, empty, and failure strings;
- 261 shared `Button` uses, 31 `IconButton` uses, six `SearchInput` uses, and
  36 `StandardSelect` uses, while many surfaces still reproduce field chrome
  and semantics locally;
- a tracked unresolved naming split between **Tasks** and **Board**
  (`cave-1yws`).

The repository already has the right visual authority in
`docs/coven-design-language.md`, the token contract in `src/app/globals.css`,
and the live `/aesthetic` reference. The gap is a missing field family, a copy
contract that is not precise enough to test, and incomplete migration onto
those standards.

## Scope

### Included

- Every mounted user-facing React surface under `src/app` and `src/components`,
  including Home, Chat, Tasks, Projects, Calendar, Automations, Grimoire,
  Familiars, Settings, Marketplace, Capabilities, integrations, browser, code,
  terminal, analytics, onboarding, overlays, popovers, and dialogs.
- Native iOS views under `apps/ios/CovenCave/CovenCave`, including widgets,
  notifications, system dialogs, empty states, field prompts, and errors that a
  person can see.
- User-facing Tauri/Rust strings such as application and quick-chat titles,
  startup alerts, native folder-picker titles, update prompts, and errors
  intentionally passed to the UI.
- Dynamic server errors when the client currently renders them directly. The
  program must add a stable user-facing summary while retaining useful
  diagnostic detail.
- Accessibility names and announcements because they are part of the product's
  language, not secondary metadata.

### Excluded

- `src/app/mockup`, generated bundles under `src-tauri/gen`, build artifacts,
  snapshots, test fixtures, vendored code, and third-party pages displayed in
  the embedded browser.
- Protocol identifiers, API field names, log-only diagnostics, stack traces,
  and developer commands that are never presented as interface copy.
- Renaming internal TypeScript, Swift, Rust, storage, or API symbols solely to
  mirror user-facing vocabulary. Internal `board`, `card`, `session`, and
  `cron` names may remain when changing them would add risk without changing
  the experience.
- A full localization launch. The design avoids blocking future localization,
  but does not introduce a cross-language string catalog or translation
  workflow.
- A wholesale visual redesign. Existing Coven tokens, typography, density,
  spacing, chrome budget, and platform-native conventions remain authoritative.

## Chosen approach

Use a **foundation-first, progressively enforced migration**.

The rejected alternatives are:

1. A surface-by-surface copy cleanup without shared enforcement. It would
   produce quick visible changes, but the same drift would return as new
   surfaces ship.
2. A centralized catalog containing every string on every platform. It would
   create high churn, awkward contextual copy, and premature localization
   machinery without solving component semantics.

The chosen approach centralizes reusable behavior and recurring grammar, not
all prose. Contextual strings stay close to their surfaces. Shared components,
an explicit copy contract, and source conformance checks make the result
coherent.

## Experience contract

### Vocabulary

- **Tasks** is the primary user-facing noun in navigation, mobile tabs,
  command-palette entries, headings, empty states, and actions.
- **Task board** names the kanban/table/calendar-style layout when the layout
  itself matters. Bare **Board** is not a top-level destination name.
- **Task** replaces visible **card** unless the interface is explicitly
  describing card-shaped presentation. Internal card types and API routes stay
  unchanged.
- **Chat** describes the conversation a person opens or returns to. **Session**
  is reserved for execution, debugging, connection, and developer-facing
  contexts where the distinction matters.
- **Familiar**, **coven**, **summon**, **sacrifice**, **ward**, and other domain
  nouns continue to follow `docs/coven-design-language.md`. Generic **agent**
  is not introduced where **familiar** is the product concept.
- **Scheduled job** is normal interface language. **Cron** appears only when a
  person is editing cron syntax or diagnosing the underlying scheduler.
- **Project** is the user-facing codebase/container noun. **Working directory**
  and `cwd` remain in technical controls where the filesystem concept is the
  actual thing being edited.

The terminology phase will absorb or supersede `cave-1yws` only when the
corresponding source changes are implemented and verified; this program does
not close that bead by documentation alone.

### Voice and casing

- Use sentence case for headings, labels, buttons, menus, placeholders,
  statuses, and announcements.
- Use active voice and name the person's action: **Save changes**, **Create
  task**, **Retry**, **Open settings**. Do not use generic **Submit**, **OK**, or
  **Confirm** when the real action is known.
- Keep the same verb through the interaction: **Publish** becomes
  **Publishing…** and then **Published**.
- Use contractions and typographic punctuation: **Couldn't**, curly
  apostrophes, and the single ellipsis character `…`.
- Keep one branded flourish at most per surface. Fields, errors, permissions,
  and recovery instructions remain plain and specific.
- Do not end fragments, labels, buttons, or placeholders with periods. Complete
  explanatory sentences use terminal punctuation.

### Labels, help, and validation

- Every editable control has a persistent visible label or an equally durable
  accessible name when the visual pattern is self-explanatory, such as global
  search. A placeholder never acts as the only label.
- Put purpose in the label, constraints in persistent help, and validation in
  an error slot. One string does not do multiple jobs.
- Mark optional fields beside the label using **Optional**. Do not hide
  optionality inside the placeholder.
- Required fields use native required semantics and concise validation. Avoid
  decorative asterisks unless the whole form explains them.
- Validation names the problem and repair: **Enter an absolute project path**,
  not **Invalid input**.
- Help and errors connect through `aria-describedby` on React and the
  equivalent accessibility semantics on iOS.

### Placeholder grammar

Placeholders provide an example, expected format, or input intent. They do not
repeat the label, carry required instructions, expose fake defaults, or hold a
keyboard shortcut that disappears when typing.

- Global discovery: **Search familiars, chats, tasks, and memory…**
- Search within one known collection: **Search tasks…**
- Narrow an already-visible collection: **Filter projects…**
- Choose from a deferred picker: **Choose a familiar…**
- Create or compose: **Describe the task…**, **Message Sage…**, **Add a note…**
- Format example: **e.g., `owner/repository`** or **e.g., `0 9 * * 1-5`**. The
  persistent label must still state what the value is.
- Secrets: **Paste personal access token**, paired with a label that names the
  provider and credential.
- Multiline examples may show one realistic entry per line but must not look
  like saved content.

Use `…`, never `...`. Avoid combining instructions, examples, shortcuts, and
scope hints into one oversized placeholder. Keyboard affordances such as Enter
to send belong in persistent utility text and accessible descriptions.

### Actions and destructive behavior

- Text buttons use a verb or an unambiguous short platform convention such as
  **Done**, **Cancel**, **Back**, and **Close**.
- Icon-only buttons require a state-aware accessible name. Toggle names describe
  the next action: **Pin chat** / **Unpin chat**.
- Destructive confirmation names the object and consequence. Reversible actions
  prefer the existing undo pattern; irreversible actions use
  `ConfirmDialog`/native confirmation with the safe action focused first.
- Disabled actions explain why in nearby persistent text or an accessible
  description. A disabled control is not the only explanation.

### Loading, empty, no-match, and failure states

- Use `Skeleton`/`SkeletonRows` for content whose shape is known and a concise
  `role="status"` message for small inline loads. Use **Loading tasks…**, not
  bare **Loading…**.
- A true empty state uses a short status headline, a sentence explaining the
  next useful step, and an action when the person can resolve it.
- A filtered no-match state names the scope and offers recovery: **No tasks
  match “release”.** followed by **Clear filters** where applicable.
- A failure is never rendered as a convincing empty state. Use `ErrorState` or
  the native iOS equivalent with **Couldn't load tasks**, a concrete recovery
  action, and stable focus/announcement behavior.
- Raw server messages may appear as secondary diagnostic detail when safe, but
  they do not replace the user-facing summary. Sensitive values and internal
  paths are never echoed unnecessarily.
- Background mutations announce success or failure through `useAnnouncer`, a
  toast, or the native iOS accessibility announcement appropriate to the
  interaction.

## Component architecture

### React/Tauri shared primitives

Keep and consistently adopt the existing primitives:

- `Button`, `IconButton`, `SearchInput`, `StandardSelect`, `Modal`,
  `ConfirmDialog`, `Popover`, `OverflowMenu`, `Tabs`, `EmptyState`,
  `ErrorState`, `Skeleton`, `LiveRegion`, `UndoToast`, and `ViewHeader`;
- existing specialized controls such as `ColorPicker`, selection toolbars,
  lifecycle badges, and property pills where their semantics match.

Add the missing field family under `src/components/ui/`:

- `Field`: owns the visible label, optional/required marker, description,
  validation message, deterministic IDs, and described-by wiring;
- `TextInput`: owns standard height, typography, border, focus, disabled,
  read-only, and invalid states while forwarding native input attributes;
- `TextArea`: shares the field chrome and semantics while supporting multiline
  sizing and resize policy;
- a small shared field stylesheet in the component-library section of
  `globals.css`, derived only from semantic tokens.

These primitives do not own business validation, network state, or
surface-specific prose. `SearchInput` may be refactored onto the same low-level
field chrome once its search-specific clear behavior remains intact.
`StandardSelect` remains the public select name during this program to avoid a
cosmetic repository-wide symbol rename.

Raw HTML controls remain valid inside the primitives and for semantic cases
that cannot be represented by them, such as hidden file inputs, range controls,
browser address behavior, content-editable editors, and bespoke chat/terminal
composers. Every exception must be explicit and accessibility-tested. The four
current native `<select>` call sites are migration debt, not permanent implicit
exceptions.

### Native iOS

Use SwiftUI-native `TextField`, `Button`, `Picker`, `Form`,
`ContentUnavailableView`, alerts, confirmation dialogs, and accessibility
modifiers. Consistency means equivalent vocabulary, state hierarchy, recovery,
and accessibility—not copying web visuals into SwiftUI.

Introduce a small iOS helper only when the audit proves repeated behavior that
native SwiftUI does not already express cleanly. Likely candidates are a shared
load-failure view and field help/error treatment. Do not wrap standard SwiftUI
controls solely to make their names match React.

### Tauri system surfaces

Keep system dialogs and platform-native controls. Consolidate repeated titles
or user summaries only when doing so prevents real drift. Rust errors retain
technical context internally and expose a stable, actionable summary at the
UI boundary.

## Conformance architecture

Add a deterministic source conformance check that scans only the approved live
source roots. It reports rule ID, source path, and a normalized excerpt.

The first enforceable rules are:

- `copy/no-ascii-ellipsis` for user-facing literals and placeholders;
- `copy/no-generic-submit` for generic action labels;
- `copy/tasks-terminology` for top-level **Board** drift after the terminology
  phase begins;
- `fields/no-placeholder-only-label` for detectable input patterns;
- `components/no-native-select` outside shared primitives and explicit
  exceptions;
- `states/no-convincing-empty-on-error` for known load/error patterns that
  collapse failures into empty collections.

Existing violations live in a reviewed debt baseline keyed by rule, path, and
normalized excerpt—not line number or count. The check fails when a new
violation appears, an entry changes without review, or a removed violation
remains in the baseline. Semantic exceptions live separately and include a
reason. Updating the baseline is visible reviewable work, not an automatic
post-test rewrite.

Each migration shrinks the debt baseline. Final completion requires the debt
baseline to be empty. Only documented semantic exceptions may remain, and each
must be supported by a test or platform constraint rather than convenience.

The conformance test is wired into `scripts/run-tests.mjs`; an unwired test is
not evidence in this repository.

## Data flow and behavior preservation

This program does not change persistence models, API contracts, task lifecycle,
chat transport, or navigation semantics solely for presentation consistency.

1. Surface state and API results continue to determine loading, empty, failure,
   and success conditions.
2. Shared components receive those conditions and the contextual copy as
   explicit props.
3. Shared components own visual and accessibility semantics; surfaces own
   business actions and domain-specific words.
4. Dynamic announcements use the same action vocabulary shown visually.
5. Errors are translated at the nearest boundary that has enough context to
   name the failed action while preserving safe diagnostic detail.

Migration must not turn controlled fields into uncontrolled fields, change
submission timing, break keyboard shortcuts, alter focus restoration, or hide
capabilities. When a visual action moves to progressive disclosure, it remains
reachable within the design-language chrome budget.

## Program phases

### Phase 0: foundation

Extend `docs/coven-design-language.md` with the testable copy contract, add and
document the React field family, expose it on `/aesthetic`, create the
conformance scanner/baseline/exception mechanism, wire its tests, and record the
authoritative starting inventory. This is the first bounded implementation
plan produced from this program design.

### Phase 1: React controls and placeholders

Migrate labels, help/error wiring, text inputs, text areas, selects, searches,
and placeholders across live React surfaces. Work lands in surface-family beads
and PRs so each change remains reviewable. The phase ends with no unexplained
raw select, placeholder-only label, or placeholder grammar violation.

### Phase 2: React states, actions, and terminology

Standardize loading, empty, filtered-empty, error, success, destructive,
announcement, navigation, and action copy. Complete the **Tasks** terminology
migration and reconcile `cave-1yws`. This phase also adopts or removes any
shared primitive found to be orphaned after mounted-surface verification.

### Phase 3: native iOS parity

Apply the same vocabulary and state contract through SwiftUI-native controls.
Cover field prompts, navigation, task/chat/familiar terminology, errors,
recovery actions, confirmations, widgets, notifications, VoiceOver, Dynamic
Type, and light/dark appearance.

### Phase 4: Tauri system copy

Audit and standardize native window titles, startup failure alerts, file/folder
pickers, updater copy, and UI-bound Rust errors on macOS, Windows, and Linux
without changing log-only diagnostics.

### Phase 5: closure audit

Re-enumerate mounted React surfaces, iOS views, and Tauri entry points; run the
source policy with an empty debt baseline; exercise representative runtime
states; and attach requirement-by-requirement evidence to `cave-xd1b`. The
umbrella closes only when every acceptance criterion is proven from current
source and runtime state.

Each phase after Phase 0 receives its own bounded design addendum, implementation
plan, and child bead before code changes. Once Phase 0 planning begins, the
umbrella remains open and unassigned while exactly one ready child bead is
claimed at a time in accordance with the repository's familiar-work protocol.

## Verification strategy

### Foundation and every React phase

- Red/green source tests for every new primitive or conformance rule.
- `pnpm check:tests-wired` so new tests actually run.
- Focused tests during each TDD cycle, then `pnpm typecheck` and `pnpm test`.
- Real-app checks on relevant surfaces using the repository run harness; use the
  native Tauri shell for terminal, browser pane, window chrome, sidecars,
  permissions, and other native-only behavior.
- Verify Coven dark, Coven light, and one non-default theme; narrow pane and
  touch layout where the component is responsive.
- Keyboard navigation, visible focus, screen-reader naming/announcements, and
  reduced motion for every affected interaction.

### Native iOS phase

- Focused Swift unit/source tests and the relevant `xcodebuild` test scheme.
- Simulator smoke checks on iPhone and iPad in light/dark appearance.
- Dynamic Type at default and an accessibility size, VoiceOver labels/actions,
  keyboard navigation on iPad where applicable, and reduced motion.

### Tauri phase

- Rust/unit and desktop permission tests, application build checks, and native
  smoke tests on available platforms.
- Platform-specific source assertions for strings that cannot be exercised on
  the current host, followed by CI evidence on Windows and Linux.

### Completion evidence

Passing tests are necessary but not sufficient. The final audit must map every
scope and acceptance item to current evidence: a source inventory result,
conformance output, focused test, full suite, screenshot, runtime interaction,
or platform CI result. Missing or indirect evidence keeps `cave-xd1b` open.

## Rollout and coordination

- Branches and worktrees are short-lived PR transport. The umbrella bead and
  its child beads hold durable status, branch/worktree/session ownership, and
  verification evidence.
- Before starting every child, re-check Beads ownership and open/all PRs for
  overlapping nouns. An in-progress bead owned by another session is not
  adopted implicitly.
- Baseline entries may shrink across concurrent PRs. Rebase from clean
  `origin/main`, regenerate findings explicitly, and review the semantic diff
  rather than resolving the baseline by count.
- A phase PR may add enforcement only for behavior it has actually migrated or
  baselined. It must not claim repository-wide completion from a narrow source
  test.
- The program finishes through protected PRs; nothing pushes directly to
  `main`.

## Acceptance mapping

1. **Approved contract and phase boundaries:** this document plus the Phase 0
   implementation plan and `cave-xd1b` evidence.
2. **Shared React primitives or explicit exceptions:** conformance output,
   focused component tests, and an empty migration-debt baseline.
3. **Uniform user-facing copy and placeholders:** copy-policy output plus the
   mounted-surface source/runtime audit.
4. **Native parity:** iOS and Tauri phase test, runtime, and CI evidence.
5. **Regression prevention:** the wired conformance suite fails on seeded rule
   violations and passes on the final source tree.
6. **Theme, responsive, touch, keyboard, screen-reader, and motion quality:**
   the per-phase runtime matrix and targeted automated assertions.
7. **Comprehensive proof:** the Phase 5 audit accounts for every in-scope
   surface and leaves no unexplained finding or required follow-up.
