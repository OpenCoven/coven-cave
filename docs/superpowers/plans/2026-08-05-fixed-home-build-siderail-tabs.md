# Fixed Home and Build Siderail Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Home and Build the first, position-stable control in both left siderail states.

**Architecture:** Keep the existing `NavSectionTabs` component and internal `home | code` routing model. Change the `code` descriptor's display label to `Build`, move the Home host's existing switcher before room-specific controls, and pin both hosts' DOM ordering with focused source-level regression tests.

**Tech Stack:** React 19, TypeScript, Node test/assert scripts, CSS modules already imported through the global sidebar facade.

---

## File Map

- Modify `src/lib/nav-section.ts`: own the visible `Build` label while preserving the internal `code` identifier.
- Modify `src/lib/nav-section.test.ts`: verify both stable identifiers and visible labels.
- Modify `src/components/sidebar-minimal.tsx`: render the shared switcher before the familiar selector and New chat action.
- Modify `src/components/workspace-sidebar.tsx`: update visible-room comments; its switcher already occupies the correct first position.
- Modify `src/components/nav-section-tabs.test.ts`: verify each host mounts the switcher before its first room-specific control.
- Keep `src/styles/sidebar-minimal/section-tabs.css` unchanged: the existing control geometry and collapsed behavior remain authoritative.

### Task 1: Pin labels and identical host ordering

**Files:**
- Modify: `src/lib/nav-section.test.ts`
- Modify: `src/components/nav-section-tabs.test.ts`

- [ ] **Step 1: Write the failing registry-label assertion**

Replace the opening section test in `src/lib/nav-section.test.ts` with:

```ts
test("the rail offers Home and Build in stable section order", () => {
  assert.deepEqual(
    NAV_SECTIONS.map(({ id, label }) => ({ id, label })),
    [
      { id: "home", label: "Home" },
      { id: "code", label: "Build" },
    ],
  );
  assert.equal(DEFAULT_NAV_SECTION, "home");
});
```

- [ ] **Step 2: Write the failing host-order assertions**

In `src/components/nav-section-tabs.test.ts`, replace the existing Home and
Chat host presence assertions with:

```ts
const homeTabsIndex = sidebar.indexOf(
  "<NavSectionTabs section={section} onSectionChange={onSectionChange}",
);
const homeFamiliarIndex = sidebar.indexOf(
  '<div className="sidebar-familiar-switch">',
);
assert.ok(homeTabsIndex >= 0, "the Home rail hosts the shared switcher");
assert.ok(
  homeTabsIndex < homeFamiliarIndex,
  "the Home / Build switcher is the first Home rail control",
);

const buildTabsIndex = chatSidebar.indexOf(
  '<NavSectionTabs section="code" onSectionChange={onSectionChange}',
);
const buildHeaderIndex = chatSidebar.indexOf('<header className="cnav__header">');
assert.ok(buildTabsIndex >= 0, "the Build rail hosts the shared switcher");
assert.ok(
  buildTabsIndex < buildHeaderIndex,
  "the Home / Build switcher is the first Build rail control",
);
```

Also update the file header from `Home | Code` to `Home | Build`, and change
the session-list assertion message to `"the session list belongs to the Build section"`.

- [ ] **Step 3: Run the focused tests and confirm they fail for the intended reasons**

Run:

```bash
node --experimental-strip-types src/lib/nav-section.test.ts
node src/components/nav-section-tabs.test.ts
```

Expected:

- `nav-section.test.ts` fails because the second visible label is still `Code`.
- `nav-section-tabs.test.ts` fails because `SidebarMinimal` currently renders
  the switcher after the familiar selector and New chat action.

- [ ] **Step 4: Record the test-first checkpoint only if commit authority is granted**

This repository's conservative profile forbids commits without explicit
authority. If authority is granted, run:

```bash
git add src/lib/nav-section.test.ts src/components/nav-section-tabs.test.ts
git commit -m "test: pin Home and Build siderail placement"
```

Otherwise, leave the focused failing tests uncommitted and continue.

### Task 2: Rename the visible tab and move the Home host switcher

**Files:**
- Modify: `src/lib/nav-section.ts`
- Modify: `src/components/sidebar-minimal.tsx`
- Modify: `src/components/workspace-sidebar.tsx`
- Test: `src/lib/nav-section.test.ts`
- Test: `src/components/nav-section-tabs.test.ts`

- [ ] **Step 1: Rename only the visible section label**

In `src/lib/nav-section.ts`, keep `id: "code"` and change its descriptor to:

```ts
{
  id: "code",
  label: "Build",
  iconName: "ph:code-bold",
  description: "Chat, coding sessions, and the code workshop",
  kbd: "⌃2",
},
```

Update prose comments that call the visible room `Code` to call it `Build`.
Keep constant and type names such as `CODE_SECTION_MODES` unchanged because
they describe the internal routing identifier.

- [ ] **Step 2: Move the shared switcher to the first Home control position**

In `src/components/sidebar-minimal.tsx`, move:

```tsx
{onSectionChange ? <NavSectionTabs section={section} onSectionChange={onSectionChange} /> : null}
```

to immediately after the rail-only decorative `sidebar-brand-mark` and before:

```tsx
<div className="sidebar-familiar-switch">
```

Do not add CSS ordering or duplicate the component. The decorative brand mark
remains non-interactive, so `NavSectionTabs` becomes the first control in both
expanded and collapsed rails.

- [ ] **Step 3: Align host comments with the visible Build label**

In `src/components/workspace-sidebar.tsx`, change the switcher comment to:

```tsx
{/* Global section switcher — Home | Build (cave-24d2r). This sidebar IS
    the Build room, so switching to Home hands the rail back to the
    standard destination list. */}
```

In `src/components/sidebar-minimal.tsx`, update the `section` prop comment from
`Home | Code` to `Home | Build`.

- [ ] **Step 4: Run focused verification**

Run:

```bash
node --experimental-strip-types src/lib/nav-section.test.ts
node src/components/nav-section-tabs.test.ts
```

Expected: both commands exit `0`; the component test prints no assertion error.

- [ ] **Step 5: Run the smallest broader sidebar validation**

Run:

```bash
node src/components/sidebar-minimal.test.ts
pnpm typecheck
```

Expected: the sidebar source-contract test passes and TypeScript exits `0`.
If `pnpm typecheck` fails in unrelated pre-existing files, record the exact
diagnostics and do not broaden this change.

- [ ] **Step 6: Verify the real UI geometry**

Launch the app from this worktree:

```bash
bash scripts/dev-app.sh
```

In the native app:

1. Open Home and note the Home / Build control's top edge.
2. Select Build and confirm the control does not move.
3. Collapse the siderail and repeat the Home-to-Build transition.
4. Confirm the labels read Home and Build when expanded, and both icons remain
   reachable when collapsed.

Stop the foreground process with `Ctrl-C`.

- [ ] **Step 7: Record verification in the bead**

Run:

```bash
bd update cave-fv5ij --append-notes "Verification passed: nav-section.test.ts, nav-section-tabs.test.ts, sidebar-minimal.test.ts, and pnpm typecheck. Native app check confirmed the Home / Build switcher stays at the same top position in expanded and collapsed siderails."
```

Run this command only after every named check has passed. If any check fails,
record that exact failure instead of writing success-shaped evidence.

- [ ] **Step 8: Commit only if explicit authority is granted**

If commit authority is granted, run:

```bash
git add \
  docs/superpowers/specs/2026-08-05-fixed-home-build-siderail-tabs-design.md \
  docs/superpowers/plans/2026-08-05-fixed-home-build-siderail-tabs.md \
  src/lib/nav-section.ts \
  src/lib/nav-section.test.ts \
  src/components/sidebar-minimal.tsx \
  src/components/workspace-sidebar.tsx \
  src/components/nav-section-tabs.test.ts
git commit -m "fix: keep Home and Build tabs fixed at siderail top"
```

Do not add an AI attribution trailer.
