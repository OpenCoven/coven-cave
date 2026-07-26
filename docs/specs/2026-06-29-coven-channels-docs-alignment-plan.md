# Coven Channels Docs Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update Coven Cave internal and user-facing docs so Cave reflects the new OpenCoven-native `@opencoven/channels` Discord connector without treating OpenClaw as the channel owner.

**Architecture:** Keep executable connector docs in `OpenCoven/coven`; add Cave-facing integration docs that explain how Cave familiars, settings, onboarding, and future channel surfaces should reference those connectors. Do not duplicate live secrets, raw channel IDs, private channel names, or Discord setup minutiae beyond linking to the source docs.

**Tech Stack:** Markdown docs in `docs/specs` plus future Cave docs under `docs/`; source-of-truth package docs in `OpenCoven/coven/packages/channels` and `OpenCoven/coven/docs/channels`.

---

## Context

`@opencoven/channels` now exists in `OpenCoven/coven/packages/channels` with Discord v1 outbound posting, 1Password-backed token resolution, logical channel mapping, smoke tests, package docs, and Discord setup docs. Cave currently still has several OpenClaw bridge surfaces and remote harness assumptions, so Cave docs need a clear boundary:

- OpenCoven owns native channel connectors.
- Cave presents and configures those connectors for humans and familiars.
- OpenClaw remains a migration/reference path, not the long-term owner of Coven channels.

The implementation worker should use the Discord package/docs as source context, but should not copy private test setup values into Cave.

## Files

- Create: `docs/channels/opencoven-channels.md`
- Create: `docs/channels/discord.md`
- Modify: `docs/knowledge-vault.md`
- Modify: `docs/mobile-readiness.md`
- Modify: `docs/specs/2026-06-29-telegram-channel-migration-plan.md` only if cross-links need adjustment after this plan is implemented
- Test: `git diff --check`
- Test: source grep for private channel/test values and raw secret patterns

## Task 1: Add a Cave channel overview doc

- [ ] **Step 1: Create `docs/channels/opencoven-channels.md`**

Use this content as the starting point:

```markdown
# OpenCoven Channel Connections

Cave uses OpenCoven-native channel connectors for delivery surfaces such as Discord and Telegram. Connector implementation lives in `OpenCoven/coven/packages/channels`; Cave docs describe how humans and familiars configure and use those connectors from the Cave product.

## Ownership model

- `OpenCoven/coven` owns connector packages, setup checklists, smoke tests, and API contracts.
- `coven-cave` owns product documentation, settings/onboarding copy, and UI plans for configuring those connectors.
- OpenClaw channel implementations are migration references only. Do not route new Coven channel ownership through OpenClaw.

## Security model

- Store live tokens and private channel IDs in 1Password.
- Pass only `op://...` references into runtime config.
- Do not put raw tokens, private channel IDs, private channel names, or local smoke-test values in docs, examples, shell history, commits, or chat.
- Prefer logical channel names in familiar-facing docs.

## Current connectors

| Connector | Status | Direction | Source docs |
|---|---|---|---|
| Discord | OpenCoven-native v1 | outbound | `OpenCoven/coven/docs/channels/discord.md` |
| Telegram | planned migration | outbound first, inbound later | `docs/specs/2026-06-29-telegram-channel-migration-plan.md` |

## Cave responsibilities

Cave should eventually provide:

- a Channel Connections settings surface;
- connector status checks that report configured/unconfigured without exposing secret values;
- familiar-level routing from logical names such as `coven-general` or `val-dm`;
- safe smoke-test affordances that send a harmless message and print no secrets;
- migration guidance for OpenClaw-backed Telegram users.
```

- [ ] **Step 2: Run a whitespace check**

Run:

```bash
git diff --check -- docs/channels/opencoven-channels.md
```

Expected: no output and exit code 0.

## Task 2: Add a Cave Discord doc that links to the package source of truth

- [ ] **Step 1: Create `docs/channels/discord.md`**

Use this content as the starting point:

```markdown
# Discord In Cave

Discord delivery is provided by the OpenCoven-native `@opencoven/channels` package. Cave should not ask users to paste Discord bot tokens or channel IDs into the app. Use 1Password references and logical channel names.

## Source of truth

- Package: `OpenCoven/coven/packages/channels`
- Connector docs: `OpenCoven/coven/docs/channels/discord.md`
- Setup checklist: `OpenCoven/coven/docs/channels/discord-setup.md`

## Cave copy rules

- Say "OpenCoven channel connector", not "OpenClaw channel".
- Say "1Password reference", not "paste the token".
- Show generic examples such as `op://VAULT/ITEM/token`.
- Do not include private channel names, test channel IDs, bot tokens, or real 1Password item titles.

## Cave UI expectations

The future Channel Connections settings surface should show:

- configured status for the Discord token reference;
- a list of logical channel aliases, not raw IDs by default;
- a smoke-test button that sends a harmless test message through `@opencoven/channels`;
- troubleshooting links back to the connector docs.
```

- [ ] **Step 2: Check for accidental sensitive examples**

Run:

```bash
rg -n 'COVEN_DISCORD_TOKEN=|COVEN_TEST_CHANNEL_ID|COVEN_DISCORD_TEST_CHANNEL_ID|\b[0-9]{17,20}\b' docs/channels
```

Expected: no matches for raw token env examples, raw test-channel env examples,
or Discord snowflake-shaped IDs introduced by this work. Also manually confirm
that no private channel name or real 1Password item title appears in the diff.

## Task 3: Cross-link from broader Cave docs

- [ ] **Step 1: Update `docs/knowledge-vault.md`**

Add a short section near the integration or memory-source discussion:

```markdown
## Channel connection docs

Cave channel delivery docs live under `docs/channels/`. Connector implementation and low-level setup checklists live in `OpenCoven/coven/packages/channels` and `OpenCoven/coven/docs/channels`.
```

If the file has a better existing integration section, place the link there instead of adding a new top-level section.

- [ ] **Step 2: Update `docs/mobile-readiness.md`**

Add one sentence to the relevant mobile/off-machine section:

```markdown
Mobile-facing channel actions should call OpenCoven channel connectors through Cave/Coven APIs; they should not require mobile users to paste raw bot tokens or private channel IDs.
```

- [ ] **Step 3: Run markdown and diff checks**

Run:

```bash
git diff --check
git diff -- docs/channels docs/knowledge-vault.md docs/mobile-readiness.md
```

Expected: no whitespace errors; diff only adds channel docs and cross-links.

## Task 4: Verification and handoff

- [ ] **Step 1: Run privacy grep**

Run:

```bash
git ls-files -co --exclude-standard -z docs/channels docs/knowledge-vault.md docs/mobile-readiness.md \
  | xargs -0 rg -n 'COVEN_DISCORD_TOKEN=|COVEN_TEST_CHANNEL_ID|COVEN_DISCORD_TEST_CHANNEL_ID|\b[0-9]{17,20}\b'
```

Expected: no matches in commit-candidate files from this docs track. Also
manually confirm that private channel names and real 1Password item titles do
not appear in the diff.

- [ ] **Step 2: Summarize docs ownership**

In the PR or handoff, state:

```text
This is a Cave documentation alignment pass. It does not change channel runtime behavior. It points Cave docs at the OpenCoven-native Discord connector and preserves 1Password-only secret handling.
```

- [ ] **Step 3: Do not commit without Val approval**

Leave the branch ready for review unless Val explicitly asks for a commit/PR.
