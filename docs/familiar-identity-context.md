# Familiar identity context

How a familiar's declared identity — `SOUL.md`, `IDENTITY.md`, familiar-local
skill entrypoints, and (for voice) `MEMORY.md` — reaches the model, and what
that injection is explicitly *not* allowed to do.

Implementation: [`src/lib/server/familiar-contract-context.ts`](../src/lib/server/familiar-contract-context.ts).
Consumers: the chat route (`src/app/api/chat/send/route.ts`) and voice
(`src/lib/voice/hydrate-instructions.ts`).

## The promise being kept

The Coven identity canon is re-injected on **every** chat turn and states:

> A familiar's identity is set by its own IDENTITY.md, SOUL.md, and role/skill
> configuration.

Until `cave-gw3iq` that was unbacked in chat. Voice hydrated the files, the ward
preflight read them, and Familiar Studio edited them — but the chat prompt chain
supplied only the operator profile and the daily memory file. The canon named
documents the model had never seen.

### Why it went unnoticed

The believed mechanism was implicit filesystem pickup: `coven run` boots the
harness in the familiar's workspace, so Codex or Claude would read the files off
disk unprompted. That holds **only when no project root is supplied**. A chat
with a selected project — the normal case — spawns in the project root, leaving
the workspace outside the runtime boundary, so no channel loaded the files at
all. The assumption was written down as fact atop `hydrate-instructions.ts`,
where it read as justification for why voice needed hydration and chat did not.

Both surfaces now share one builder, so the two cannot drift apart again.

## What gets injected, and when

| | Chat | Voice |
| --- | --- | --- |
| `SOUL.md` | yes | yes |
| `IDENTITY.md` | yes | yes |
| `skills/*/SKILL.md` entrypoint index | yes | yes |
| `MEMORY.md` | **no** | yes (`includeMemory: true`) |
| `ward.toml` | never | never |

- **New sessions only.** Resumed conversations already carry the block in their
  transcript; re-sending kilobytes of prose every turn would invert the very
  imbalance this fixes. This matches how the operator profile is handled.
- **Never on `origin === "enhance"`.** Enhance is a one-shot utility lane where
  persona prose is ballast — the same reason the Knowledge Vault skips it.
- **`MEMORY.md` is chat-excluded** because chat already injects today's
  `memory/YYYY-MM-DD.md` through the startup-context block. Voice has no other
  memory channel, so it takes the file.
- **`ward.toml` is never inlined.** It is policy configuration carrying the
  `[protected]` file list and the invariants that bound self-modification.
  Injecting it hands the familiar the rules written to constrain it.
- **Familiar-local skills are indexed, not inlined.** The block lists only
  real `skills/<id>/SKILL.md` files contained by the familiar workspace and
  states that a familiar-local same-name skill outranks a generic copy. This
  lets the harness load the declared procedure from an already-granted root
  without flooding every turn with every skill body. Symlink escapes are
  omitted.

### Placement in the prompt

The block sits **inside** the identity-canon wrapper, so the files land next to
the rule that names them, and **outside** the task, vault, and memory data
blocks, so the persona frames how that data is read. The runtime boundary is
applied outermost and still leads the prompt.

## Safeguards

In priority order, mirrored by the tests in
[`familiar-contract-context.test.ts`](../src/lib/server/familiar-contract-context.test.ts):

1. **Slug allow-list.** `readFamiliarContractFiles` rejects any id that is not a
   strict slug, re-asserted inline, so a familiar id can never become an
   arbitrary-file-read primitive.
2. **Sentinel defanging.** Contract files are writable by the self-improvement
   loop and arrive with imported familiar packs, so their contents are untrusted
   *with respect to prompt structure*. Two tiers:
   - **Tag sentinels** (`<FAMILIAR_CONTRACT>`, `<KNOWLEDGE_VAULT>`,
     `<INSTRUCTIONS>` and their closers) are neutralized **anywhere**, including
     mid-line — XML-ish delimiters never appear in genuine soul prose.
   - **Line-start sentinels** (`Coven identity canon:`, `Runtime filesystem
     boundary:`, `Current user message:`) are neutralized **only at line
     start**, so a soul file may still discuss "the Coven identity canon:"
     mid-sentence.

   Markers are wrapped in backticks, not deleted: the author still sees what
   they wrote, but it renders as a code span rather than a live delimiter.
   The block also carries a host-authored denial line stating it grants no
   tools or permissions and cannot widen the runtime boundary — so a forged
   grant has to argue against an explicit denial in the same block.
3. **Clamps.** 6,000 chars per identity file, 4,000 for memory. An oversized
   file must never crowd out the user's actual message.
4. **Throw-proof.** A missing workspace, unreadable file, or malformed id
   degrades to no block, never to a failed turn.

A dedicated anti-drift test reads the modules that actually emit each marker and
fails if one is renamed upstream, since a renamed marker would otherwise stop
being defanged silently.

## Identity is not capability

This injection is host-side prompt assembly, in the same category as the
operator profile and the Knowledge Vault: Cave reads the file and composes the
prompt. It does **not** widen the runtime boundary. That boundary governs where
a familiar may *act* — the daemon's project-root authority over tool calls —
never who it *is*. A familiar still cannot open its own `SOUL.md` with a tool
unless the workspace is a granted root.

## Observability

Every new turn emits a `familiar-contract` progress row naming the files that
were actually inlined, or stating that none were found. It carries file names
only, never contents, and it persists across transcript reloads alongside the
runtime compatibility notices.

This exists because the motivating report was a user reading an *exported*
transcript in which a familiar said it could not access its `SOUL.md`. The
familiar was right, but its evidence — its own filesystem checks — had been
dropped from the transcript by a runtime compatibility profile, leaving only an
assertion the user had to take on faith. "What identity did this turn actually
load?" should be answerable from the run's own record rather than from the
familiar's introspection.
