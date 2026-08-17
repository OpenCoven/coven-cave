> **DO NOT COMMIT THIS FILE.** It is an untracked cross-session notice.
> Delete it once every affected session has recovered its work.

# Worktree sweep — 2026-08-15

The repo owner asked for every worktree with uncommitted changes to be retired.
**14 worktrees were removed, and no work was lost.** Each tree's uncommitted
files were committed and pushed as a signed tag, verified on origin by peeled
SHA, *before* the tree was removed.

If a worktree you were using has vanished, find your branch below.

| branch | files preserved | recover from tag |
| --- | --- | --- |
| `fix/cave-1c8zf-compact-tool-rollup` | 22 | `wip-archive/fix-cave-1c8zf-compact-tool-rollup-2026-08-15` |
| `fix/cave-1c8zf-compact-tool-rollup-pr` | 2 | `wip-archive/fix-cave-1c8zf-compact-tool-rollup-pr-2026-08-15` |
| `fix/cave-203ob-beads-trigger` | 4 | `wip-archive/fix-cave-203ob-beads-trigger-2026-08-15` |
| `fix/cave-64xnl-research-improve-idempotent` | 3 | `wip-archive/fix-cave-64xnl-research-improve-idempotent-2026-08-15` |
| `feat/cave-6jpum-primary-blocker-promotion` | 4 | `wip-archive/feat-cave-6jpum-primary-blocker-promotion-2026-08-15` |
| `feat/cave-9oi1s-home-continue-carousel-v2` | 4 | `wip-archive/feat-cave-9oi1s-home-continue-carousel-v2-2026-08-15` |
| `feat/cave-dhdm8-chat-preview` | 16 | `wip-archive/feat-cave-dhdm8-chat-preview-2026-08-15` |
| `fix/cave-dvi73-thread-signal-overlay` | 5 | `wip-archive/fix-cave-dvi73-thread-signal-overlay-2026-08-15` |
| `fix/cave-fhosx-carousel-image-fill` | 4 | `wip-archive/fix-cave-fhosx-carousel-image-fill-2026-08-15` |
| `feat/cave-i9mek-blog-visual-controls` | 8 | `wip-archive/feat-cave-i9mek-blog-visual-controls-2026-08-15` |
| `feat/cave-k11i6-marketplace-logos` | 23 | `wip-archive/feat-cave-k11i6-marketplace-logos-2026-08-15` |
| `feat/cave-onpeg-adaptive-followups` | 5 | `wip-archive/feat-cave-onpeg-adaptive-followups-2026-08-15` |
| `fix/cave-q9330-windows-cli-setup` | 1 | `wip-archive/fix-cave-q9330-windows-cli-setup-2026-08-15` |
| `feature/opencoven-chat-api` | 6 | `wip-archive/feature-opencoven-chat-api-2026-08-15` |

## Recover

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave
git fetch origin --tags
git worktree add .worktrees/<name> <tag-from-the-table>
# lands on a detached HEAD at the snapshot commit; to carry on working:
git -C .worktrees/<name> switch -c <your-branch>-restored
# the snapshot is a checkpoint, not a real change — unwind it, keep the files:
git -C .worktrees/<name> reset --soft HEAD~1
```

## Every preservation tag, as it stands on origin right now

Read live from `git ls-remote --tags origin` when this notice was written, so
each line below is a tag that actually exists remotely — not a claim from a log.

### Dirty-tree snapshots (`wip-archive/*`) — the 14 worktrees retired in the sweep

```
wip-archive/feat-cave-6jpum-primary-blocker-promotion-2026-08-15
wip-archive/feat-cave-9oi1s-home-continue-carousel-v2-2026-08-15
wip-archive/feat-cave-dhdm8-chat-preview-2026-08-15
wip-archive/feat-cave-i9mek-blog-visual-controls-2026-08-15
wip-archive/feat-cave-k11i6-marketplace-logos-2026-08-15
wip-archive/feat-cave-onpeg-adaptive-followups-2026-08-15
wip-archive/feature-opencoven-chat-api-2026-08-15
wip-archive/fix-cave-1c8zf-compact-tool-rollup-2026-08-15
wip-archive/fix-cave-1c8zf-compact-tool-rollup-pr-2026-08-15
wip-archive/fix-cave-203ob-beads-trigger-2026-08-15
wip-archive/fix-cave-64xnl-research-improve-idempotent-2026-08-15
wip-archive/fix-cave-dvi73-thread-signal-overlay-2026-08-15
wip-archive/fix-cave-fhosx-carousel-image-fill-2026-08-15
wip-archive/fix-cave-q9330-windows-cli-setup-2026-08-15
```

### Archived branch heads (`archive/*-2026-08-15`) — remote branches deleted the same day

Branches retired to keep the branch list small. The commits live on in these tags;
nothing here was merged into `main` unless its PR says so.

```
archive/agent-wardsunder-resume-trust-gate-2026-08-15
archive/chore-cave-hmltt-react-hooks-lint-pre-rebase-2026-08-15
archive/chore-cave-hmltt-react-hooks-lint-pre-rebase2-2026-08-15
archive/feat-cave-4akqc-chat-turn-fold-2026-08-15
archive/feat-cave-9rwd-1-dashboard-contract-2026-08-15
archive/feat-cave-dfi0d-calm-streaming-chat-2026-08-15
archive/feat-cave-onpeg-1-adaptive-followups-2026-08-15
archive/feat-cave-r3vmj-research-intent-capacity-2026-08-15
archive/feat-cave-x07-host-capability-grants-2026-08-15
archive/feat-cave-z9i-windows-hyperv-audit-broker-2026-08-15
archive/feature-client-v1-2026-08-15
archive/fix-cave-0uzj0-shell-frame-gutters-2026-08-15
archive/fix-cave-64t9u-pin-fixes-only-2026-08-15
archive/fix-cave-e8z-research-review-character-limits-2026-08-15
archive/fix-cave-e8z-research-review-character-limits-pre-clean-rewrite-2026-08-15-025f90c
archive/fix-cave-ktvy0-initialtab-contract-tests-2026-08-15
archive/pr-4597-2026-08-15
archive/pr4624-refresh-2026-08-15-b5a42db3e
archive/recovery-cave-1c8zf-20260814T125722Z-2026-08-15
```

## Also recorded

- **Beads** — each owning bead carries a comment with the snapshot commit SHA,
  the old worktree path, and the recovery tag (`bd show <id>`).
- **Full pre-sweep listing** — `.cave-trash/dirty-tree-sweep-2026-08-15.txt`,
  every one of the 107 preserved paths, if you need to find a file by name.
