# Telegram Channel Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Telegram channel connection from OpenClaw-owned runtime behavior into OpenCoven-native channel infrastructure without breaking Val's existing Telegram direct-message workflow.

**Architecture:** Treat OpenClaw's Telegram implementation as the compatibility reference, not the long-term runtime owner. First land an OpenCoven Telegram connector for safe outbound delivery; then add Cave docs/settings and a migration inventory; then move inbound/session handling only after outbound, auth, allowlists, and transcript compatibility are verified.

**Tech Stack:** `@opencoven/channels` in `OpenCoven/coven`, Cave docs/settings in `coven-cave`, existing Cave OpenClaw session parsing (`src/lib/session-initiator.ts`), OpenClaw Telegram docs/extension as migration reference, 1Password refs for live tokens and chat IDs.

---

## Migration Principles

- No raw Telegram bot tokens, chat IDs, private channel names, or sender IDs in docs, commits, shell history, or chat.
- Use 1Password references for tokens and private targets.
- Preserve the existing human experience during cutover: Telegram messages should keep reaching the same familiar, and replies should stay in the same human-visible conversation.
- Preserve session identity semantics where possible: OpenClaw-style keys such as `agent:<familiar>:telegram:<scope>:<id>` and topic suffixes are compatibility inputs.
- Do not disable OpenClaw Telegram until OpenCoven outbound smoke, inbound routing, allowlist behavior, and transcript attribution are all verified.

## Current Reference Points

OpenClaw already has a mature Telegram stack:

- BotFather token setup, long polling default, optional webhook mode.
- DM policies: pairing, allowlist, open, disabled.
- Group policy and group sender allowlists.
- Group/forum topic support and topic-aware session keys.
- Message send/action paths and health/probe coverage.
- Cave already parses OpenClaw Telegram transcript metadata into human initiators in `src/lib/session-initiator.ts`.
- Cave already treats `telegram` as a remote lane in `src/lib/presence.ts`.

The OpenCoven target should preserve the parts Val relies on first, then graduate the richer group/topic behavior.

## Phased Strategy

### Phase 1: Outbound Telegram Connector in `OpenCoven/coven`

**Outcome:** Coven can send a Telegram message without OpenClaw.

**Files:**
- Create: `OpenCoven/coven/packages/channels/src/telegram/index.ts`
- Create: `OpenCoven/coven/packages/channels/src/telegram/format.ts`
- Create: `OpenCoven/coven/packages/channels/src/telegram/auth.ts`
- Modify: `OpenCoven/coven/packages/channels/src/index.ts`
- Create: `OpenCoven/coven/packages/channels/test/telegram*.test.ts`
- Create: `OpenCoven/coven/packages/channels/test/telegram.smoke.ts`
- Create: `OpenCoven/coven/docs/channels/telegram.md`
- Create: `OpenCoven/coven/docs/channels/telegram-setup.md`

- [ ] **Step 1: Define connector scope**

Telegram v1 should support:

- `createConnector("telegram")`
- `TelegramConnector.send(target, message)`
- text messages;
- conservative embed degradation into readable text;
- optional reply/thread metadata only if it can be represented without widening the shared `ChannelMessage` too early;
- one live smoke test that sends a harmless message to a private target.

Telegram v1 should not support:

- inbound updates;
- pairing;
- group authorization;
- media uploads;
- approvals;
- command menus;
- webhook hosting.

- [ ] **Step 2: Use 1Password-only auth**

Use environment names that mirror Discord:

```sh
COVEN_TELEGRAM_TOKEN_REF='op://VAULT/ITEM/token'
COVEN_TELEGRAM_TEST_TARGET_REF='op://VAULT/ITEM/test-chat-id'
```

Do not add `COVEN_TELEGRAM_TOKEN=<raw>` examples. If a channel-name lookup is not reliable for Telegram DMs, prefer a 1Password target ref over raw target IDs.

- [ ] **Step 3: Add unit tests before implementation**

Test cases:

- token reference is required and read through shared 1Password helpers;
- failed 1Password reads do not echo the ref or token;
- text messages map to Telegram `sendMessage`;
- embed messages degrade into deterministic Markdown-safe or plain text;
- long messages are chunked below Telegram send limits;
- API failures redact bot-token-shaped URLs;
- logical target aliases resolve before send.

- [ ] **Step 4: Add a smoke test**

The smoke test should skip when refs are missing and print only:

```text
Telegram smoke test sent.
```

It must not print token, chat ID, user ID, response body containing private metadata, or target ref.

### Phase 2: Cave Docs And Product Copy

**Outcome:** Cave has internal docs explaining that Telegram is moving to OpenCoven-native channels and how the cutover works.

**Files:**
- Create: `coven-cave/docs/channels/telegram.md`
- Modify: `coven-cave/docs/channels/opencoven-channels.md`
- Modify: `coven-cave/docs/specs/2026-06-29-coven-channels-docs-alignment-plan.md`

- [ ] **Step 1: Create Cave Telegram doc**

The doc should say:

- OpenClaw is the current reference/runtime path for mature Telegram behavior.
- OpenCoven-native Telegram starts outbound-only.
- The migration goal is seamless continuity, not a forced reset.
- Cave should show Telegram as a channel connection, not as an OpenClaw-only concept.

- [ ] **Step 2: Document cutover states**

Use these states:

| State | Meaning |
|---|---|
| OpenClaw-owned | Current live Telegram behavior is served by OpenClaw. |
| Dual-probe | OpenCoven can send outbound smoke messages, OpenClaw still handles inbound. |
| Dual-write optional | Selected system messages can be sent by OpenCoven while OpenClaw remains fallback. |
| OpenCoven-owned outbound | OpenCoven sends routine outbound Telegram messages. |
| OpenCoven-owned inbound | OpenCoven receives Telegram updates and owns session routing. |

- [ ] **Step 3: Keep source links local**

Link to local docs paths, not private messages or chat transcripts:

- `OpenCoven/coven/docs/channels/telegram.md`
- `OpenCoven/coven/docs/channels/telegram-setup.md`
- `OpenClaw/openclaw/docs/channels/telegram.md`

### Phase 3: Migration Inventory And Compatibility Map

**Outcome:** We know exactly what must migrate before disabling OpenClaw Telegram.

**Files:**
- Create: `coven-cave/docs/specs/2026-06-29-telegram-openclaw-compatibility-map.md`
- Future code files should be planned only after this map is reviewed.

- [ ] **Step 1: Inventory non-secret OpenClaw concepts**

Document the compatibility surface without copying live values:

- bot account/default account;
- DM policy;
- allowed sender model;
- group allowlist model;
- group/topic routing;
- session key format;
- transcript metadata fields such as `senderName`, `senderUsername`, and `sourceChannel`;
- delivery metadata needed to reply to the same Telegram target.

- [ ] **Step 2: Inventory secret-bearing fields by reference only**

Document fields by purpose and future reference names:

```text
bot token -> COVEN_TELEGRAM_TOKEN_REF
private DM target -> COVEN_TELEGRAM_TARGET_<ALIAS>_REF
optional group target -> COVEN_TELEGRAM_GROUP_<ALIAS>_REF
```

Do not copy raw IDs or real 1Password item titles.

- [ ] **Step 3: Define compatibility tests**

At minimum:

- existing OpenClaw Telegram transcript metadata still renders as "Valentina / Telegram" in Cave;
- OpenCoven Telegram outbound messages can be attributed to a familiar;
- session keys with group/topic shape parse without losing the familiar id;
- missing or unresolved token refs fail closed;
- private target refs are never logged.

### Phase 4: Cave Settings/Status Plan

**Outcome:** Cave can guide setup without owning raw secrets.

**Files to plan in the implementation PR:**
- `src/components/settings-*` files for a Channel Connections section;
- `src/app/api/...` route only if Cave needs status checks;
- tests beside existing settings/search/shell tests.

- [ ] **Step 1: Add a docs-only UI contract first**

The UI contract should show:

- Telegram status: not configured, token ref set, outbound smoke passed, inbound owner pending;
- Discord status: token ref set, outbound smoke passed;
- secret values never displayed;
- target aliases shown instead of target IDs.

- [ ] **Step 2: Add tests before UI implementation**

Tests should assert:

- search finds "Telegram" and "Discord" channel settings;
- private refs are not displayed;
- raw target IDs are not rendered;
- setup copy says "1Password reference";
- OpenClaw migration copy clearly says OpenClaw remains fallback until cutover.

### Phase 5: Inbound Telegram In OpenCoven

**Outcome:** OpenCoven can receive Telegram updates and route them to familiars without OpenClaw.

This phase should start only after Phase 1 through Phase 4 are reviewed.

- [ ] **Step 1: Choose polling before webhook unless hosting is ready**

Long polling is the safer first native path because it matches OpenClaw's default and avoids public webhook hosting decisions.

- [ ] **Step 2: Implement fail-closed access**

Start with one-owner direct-message allowlist. Then add groups and topics after DM parity.

- [ ] **Step 3: Preserve transcript attribution**

Inbound events should carry sanitized sender metadata compatible with Cave's existing initiator parsing:

```ts
{
  sourceChannel: "telegram",
  senderName: "<display name>",
  senderUsername: "<username when present>"
}
```

No raw sender IDs should be shown in normal UI labels.

- [ ] **Step 4: Add dual-run cutover**

Before disabling OpenClaw Telegram:

- keep OpenClaw running as fallback;
- run OpenCoven outbound smoke;
- run OpenCoven inbound DM test;
- run group/topic test if group routing is used;
- compare transcript attribution in Cave;
- document rollback: re-enable OpenClaw Telegram and stop OpenCoven polling.

## Recommended Immediate Plan

1. Land the Discord/Cave docs alignment plan.
2. Implement OpenCoven Telegram outbound connector in `OpenCoven/coven`.
3. Add Cave Telegram docs and compatibility map.
4. Add Cave Channel Connections status UI.
5. Only then migrate inbound Telegram routing out of OpenClaw.

This order keeps Val's current Telegram workflow alive while OpenCoven gains ownership one verified layer at a time.

## Verification

For docs-only plan work:

```bash
git diff --check
rg -n 'TELEGRAM_BOT_TOKEN=|BOT_TOKEN=|COVEN_TELEGRAM_TOKEN=|\b[0-9]{17,20}\b' docs/channels
```

Expected:

- no whitespace errors;
- no raw token examples;
- no Telegram/Discord ID-shaped private values introduced by the docs.
- no private channel names or real 1Password item titles in the diff.

For future connector implementation:

```bash
cd OpenCoven/coven/packages/channels
npm ci
npm run build
npm test
npm run test:smoke
python3 ../../scripts/check-secrets.py
git diff --check
```

Adjust paths to the actual worktree. Do not run a live smoke test unless Val has explicitly provided safe 1Password refs for that connector.
