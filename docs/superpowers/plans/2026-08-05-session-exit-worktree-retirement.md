# Session-Exit Worktree Retirement Implementation Plan

**Status: Retired by #5399.** Local `SAFE-RETIRE` classification does not prove
ownership, runtime exclusion, or remote retention. The automatic hook and
package shortcut are removed, and the script now refuses without side effects.
Preserve this plan as history; use
[GitHub work tracking](../../workflows/github-work-tracking.md) for the current
authorized retirement procedure.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. **Checkbox state in this document is not evidence of completion. Verify what has shipped against code and merged PRs.**

**Goal:** Retire clean local worktrees already merged into `main` when a Claude session ends.

**Architecture:** `worktree-session-exit-retirement.mjs` invokes the existing
local status classifier, removes only `SAFE-RETIRE` rows, and records outcomes
without making session exit fail. A `SessionEnd` hook and package script invoke
the same command.

**Tech Stack:** Node.js ESM, local Git CLI, Node built-in test runner, pnpm.

---

### Task 1: Implement and wire local exit retirement

**Files:**
- Create: `scripts/worktree-session-exit-retirement.mjs`
- Create: `scripts/worktree-session-exit-retirement.test.mjs`
- Modify: `.claude/settings.json`
- Modify: `package.json`
- Modify: `scripts/run-tests.mjs`

- [x] **Step 1: Add fixture coverage for safe removal and fail-closed retention**
- [x] **Step 2: Add a local-only command that consumes `wt:status --json`**
- [x] **Step 3: Wire the command to `SessionEnd` and the application test suite**
- [ ] **Step 4: Run focused tests, test-wiring, and typecheck**
