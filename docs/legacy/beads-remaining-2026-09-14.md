# Remaining legacy Beads: frozen inventory

**Status: Archive.** Development tracking moved to GitHub Issues and the
[Cave Project](https://github.com/orgs/OpenCoven/projects/9) under issue #5399.
This is a one-time notation, not another queue, an instruction to resume work,
or a request to create one GitHub issue per row.

Snapshot captured 2026-09-14T13:15:08.640Z; exported 2026-09-14T13:22:05.314Z.
Source: `.beads/embeddeddolt/cave`,
queried only through an isolated filesystem copy. The original engine was
never opened and its locks, schema, records, and sync refs were left alone.
Captured manifest SHA-256: `e975a4bfa96951370dd213068c7a9833f49f5a46fa4573a99ade228382467a7a`, matching the source
before and immediately after copying. Telemetry and automatic GC were disabled;
all engine initialization was confined to the temporary copy and separate home.

A filesystem copy is not a transactionally locked live export. These are
snapshot counts, not current execution clearance. The old four-row committed
JSONL export was not used. Only literal `closed` is excluded.
**The source changed after capture**, so its current totals may differ.

**187 non-closed records** are preserved below.

| Store | Legacy status | Records |
| --- | --- | ---: |
| issues | closed | 2237 |
| issues | blocked | 112 |
| issues | open | 58 |
| issues | in\_progress | 16 |
| wisps | closed | 10 |
| wisps | blocked | 1 |

Excluded non-Cave-prefix records: 0.
Preserved dependency links for non-closed records: 293.
Dependency types are original relationships, not automatically blockers.
Wisp records are listed separately because they are ephemeral operational
state, not necessarily durable development tasks.

Descriptions, comments, notes, metadata, creator/contact fields, and private
transcripts were not queried. Contact addresses and personal paths are omitted
from display fields. Only credential-free GitHub issue/PR links are published;
other external references remain in the private minimal snapshot.

When intentionally resuming an outcome, inspect its linked GitHub issue and
current evidence, preserve existing owners, and follow
[GitHub work tracking](../workflows/github-work-tracking.md).

## Durable records

| ID | Title | Legacy status | Priority | Assignee | Existing GitHub reference | Dependencies |
| --- | --- | --- | ---: | --- | --- | --- |
| cave-1sh6p | Coven Automations v1 — time, retry, cancel, fencing, recovery (GitHub OpenCoven/coven#856) | open | 0 | (not recorded) | https://github.com/OpenCoven/coven/issues/856 | blocks: cave-stsf7; relates-to: cave-tm1y0 |
| cave-269tq | Repair MarkdownWebView ownership cycle and deterministic teardown | blocked | 0 | cody | https://github.com/OpenCoven/coven-cave/issues/5312 | (none stored) |
| cave-88pe8 | GitHub Support: clear four uncancellable July Actions runs | blocked | 0 | (not recorded) | (not recorded) | blocks: cave-zsxpd |
| cave-bij73 | Qualify PR 5324 lifecycle repair: awaiting transport approval | blocked | 0 | cody | https://github.com/OpenCoven/coven-cave/pull/5324 | (none stored) |
| cave-d9clv | Await exact-build TestFlight availability receipt for iOS 0.4.2 | blocked | 0 | cody | (not recorded) | (none stored) |
| cave-dbkng | Coven Automations v1 — principal/familiar/authority/approval/receipt binding (GitHub OpenCoven/coven#857) | open | 0 | (not recorded) | https://github.com/OpenCoven/coven/issues/857 | blocks: cave-6jswi; blocks: cave-m9tw3; relates-to: cave-tm1y0 |
| cave-g7zda | Urgently deliver iOS responsiveness hotfix to TestFlight | blocked | 0 | cody | (not recorded) | blocks: cave-d9clv |
| cave-hlv.9 | Coven Automations v1 — release go/no-go rollup (GitHub OpenCoven/coven#854) | open | 0 | (not recorded) | https://github.com/OpenCoven/coven/issues/854 | blocks: cave-1sh6p; blocks: cave-6jswi; blocks: cave-90hwl; blocks: cave-dbkng; blocks: cave-e52qp; blocks: cave-hlv.10; blocks: cave-m9tw3; blocks: cave-qwnxq; blocks: cave-stsf7; blocks: cave-tm1y0; blocks: cave-x28j6; blocks: cave-xqbs4; blocks: cave-yaul2; parent-child: cave-hlv |
| cave-tm1y0 | Finish Cave Automations protocol canary and reconcile closed upstream OpenCoven/coven#855 | blocked | 0 | Kitty | https://github.com/OpenCoven/coven/issues/855 | blocks: cave-stsf7 |
| cave-tsvfj.4 | Atomically bind Client v1 secrets to Cave runtime | in\_progress | 0 | Val Alexander | https://github.com/OpenCoven/coven-cave/issues/4996 | parent-child: cave-tsvfj |
| cave-x28j6 | Coven Automations v1 — conformance, chaos, SLO, operator diagnostics (GitHub OpenCoven/coven#858) | open | 0 | (not recorded) | https://github.com/OpenCoven/coven/issues/858 | blocks: cave-1sh6p; blocks: cave-dbkng; blocks: cave-tm1y0 |
| cave-0567z | \[Chat v1 P5\] Native lifecycle, offline reads, settings, and tooling | blocked | 1 | (not recorded) | (not recorded) | relates-to: cave-2m6q0; relates-to: cave-f1k8n; relates-to: cave-k0aqq; relates-to: cave-wcpm6; relates-to: cave-x8ikk; relates-to: cave-x8mcl; until: cave-rbikx |
| cave-0orvs | \[Chat v1 P2\] Canonical reads and usable messaging shell | blocked | 1 | (not recorded) | (not recorded) | relates-to: cave-3yax4; relates-to: cave-ff3j6; relates-to: cave-g9d49; relates-to: cave-hjy2f; relates-to: cave-k0aqq; relates-to: cave-mfcsz; until: cave-8ywi2 |
| cave-21rsk | Restore fail-closed tag-push releases: provision OpenClaw registry anchors | blocked | 1 | (not recorded) | (not recorded) | (none stored) |
| cave-2if4y | Prevent rapid Vault hide from flashing secret text | open | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-2m6q0 | \[Chat v1 P5\] opencoven diagnostics, completions, and TypeScript scaffolds | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-gylsl; relates-to: cave-0567z |
| cave-2rvgd | Re-land #5388 and #5391 — reverted on a wrong diagnosis | open | 1 | (not recorded) | (not recorded) | (none stored) |
| cave-37pyk | \[Chat v1 P6\] Execute security boundary and hostile-input matrix | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-rbikx; relates-to: cave-z2af3 |
| cave-3t3ua | Reconcile Chat v1 and Research program truth | in\_progress | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-4ezrj | Authorize all main-role windows through Tauri capabilities | blocked | 1 | Val Alexander | (not recorded) | blocks: cave-1c33f; blocks: cave-hkmyw |
| cave-4hhna | Keep Cave runtime alive until the last main window closes | blocked | 1 | Val Alexander | (not recorded) | blocks: cave-1c33f |
| cave-4vi9i | Unlock iPhone for iOS Release-device measurements | blocked | 1 | cody | https://github.com/OpenCoven/coven-cave/issues/5292 | (none stored) |
| cave-563z7 | \[Chat v1 P7\] Publish TypeScript packages, Rust crates, CLI, and docs | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-b6wsl; relates-to: cave-j65ie |
| cave-5jcgw | \[Chat v1 P4\] Cave attachments and privileged action authority | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-e1kfa; relates-to: cave-zcsl9 |
| cave-5zfxv | Complete September 9 fix branch landing dispositions | in\_progress | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-6sles | Deliver externalized Research Desk end to end | open | 1 | BunsDev | https://github.com/OpenCoven/coven-cave/pull/4872 | (none stored) |
| cave-6sles.12 | Unit 3 Add Mission v2 gateway | open | 1 | BunsDev | (not recorded) | blocks: cave-6sles.1; blocks: cave-6sles.11; parent-child: cave-6sles |
| cave-6sles.13 | Gate C0 Decide Research Cloud ownership | blocked | 1 | BunsDev | https://github.com/OpenCoven/coven-cave/issues/4898 | blocks: cave-6sles.12; blocks: cave-6sles.8; parent-child: cave-6sles |
| cave-6sles.14 | Unit 4 Build Cave Device Executor | blocked | 1 | BunsDev | (not recorded) | blocks: cave-6sles.12; blocks: cave-6sles.13; parent-child: cave-6sles |
| cave-6sles.15 | Unit 5 Build Hosted Research Cloud | blocked | 1 | BunsDev | (not recorded) | blocks: cave-6sles.1; blocks: cave-6sles.12; blocks: cave-6sles.13; blocks: cave-6sles.14; blocks: cave-6sles.8; parent-child: cave-6sles |
| cave-8ywi2 | \[Chat v1 P2 Gate\] Canonical reads and messaging shell verified | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-3yax4; blocks: cave-ff3j6; blocks: cave-g9d49; blocks: cave-hjy2f; blocks: cave-mfcsz; relates-to: cave-0orvs |
| cave-90esv | \[Chat v1 P6\] Package, provenance, completion, and secret-safety gates | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-rbikx; relates-to: cave-z2af3 |
| cave-90hwl | Coven Automations v1 — constrained SDK types, subscriptions, verification, commands (GitHub OpenCoven/sdk#80) | open | 1 | (not recorded) | https://github.com/OpenCoven/sdk/issues/80 | blocks: cave-x28j6 |
| cave-9jt60 | Windows packaged server stalls at boot after #5388 | open | 1 | (not recorded) | (not recorded) | (none stored) |
| cave-9rwd | Build shared Familiar command center with native iOS hub | open | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-as76u | \[Chat v1 P7\] Schedule authority-main and compatibility canaries | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-563z7; blocks: cave-gcb0i; blocks: cave-mbekl; relates-to: cave-j65ie |
| cave-b19vw | Throughput closeout: drain merged and design-ready Cave work | open | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-b6wsl | \[Chat v1 P6 Gate\] Production hardening budgets verified | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-37pyk; blocks: cave-90esv; blocks: cave-fuahq; blocks: cave-o8gc4; blocks: cave-v1vz0; relates-to: cave-z2af3 |
| cave-cgk9v | Maintenance fence catch-22: in-session beads:worktrees:create can never drain its own coven-run writer intent | open | 1 | (not recorded) | (not recorded) | (none stored) |
| cave-cgk9v.1 | Await commit/PR approval: Coven drain explanation and override | blocked | 1 | cody | (not recorded) | parent-child: cave-cgk9v |
| cave-citld | Blocked on active repository writer: call transcript and title-bar context | blocked | 1 | cody | (not recorded) | (none stored) |
| cave-e1kfa | \[Chat v1 P3 Gate\] Complete chat loop and recovery verified | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-inpy5; blocks: cave-ixa2o; blocks: cave-jmav9; blocks: cave-nz54o; blocks: cave-p4ilm; relates-to: cave-uxlxg |
| cave-e3ji9 | \[Chat v1 P4\] Hostile content, attachments, and action conformance | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-5jcgw; blocks: cave-hvnv8; blocks: cave-tma63; blocks: cave-zrc51; relates-to: cave-zcsl9 |
| cave-e52qp | Coven Automations v1 — oversight, approvals, recovery, compatibility retirement (GitHub OpenCoven/coven-cave#5217) | open | 1 | (not recorded) | https://github.com/OpenCoven/coven-cave/issues/5217 | blocks: cave-x28j6 |
| cave-ei0c2 | Provision dedicated GitHub maintenance App | open | 1 | BunsDev | (not recorded) | (none stored) |
| cave-emi6j | Design instant native iOS chat performance | open | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-es2do | Repair live voice provider integrations | in\_progress | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-eyhjy | Portraits prepared; managed landing awaits writer drain or explicit exception | blocked | 1 | nova | (not recorded) | blocks: cave-cgk9v |
| cave-ezu8k | Make native chat progress compact, expressive, and truthful | in\_progress | 1 | cody | (not recorded) | (none stored) |
| cave-f2zu2 | Canonical session lifecycle taxonomy and shared SessionRow (redesign handoff phase 1 keystone) | in\_progress | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-ff3j6 | \[Chat v1 P2\] Chat shell, filters, search, and canonical transcript | open | 1 | (not recorded) | (not recorded) | blocks: cave-23nmv; relates-to: cave-0orvs |
| cave-fh9so | Finish unified-sidebar tooltip and stale-comment cleanup | open | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-fuahq | \[Chat v1 P6\] Execute accessibility and keyboard matrix | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-rbikx; relates-to: cave-z2af3 |
| cave-gcb0i | \[Chat v1 P7\] Build signed cross-platform Chat packages and updater | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-b6wsl; relates-to: cave-j65ie |
| cave-gylsl | \[Chat v1 P4 Gate\] Rich content, attachments, and actions verified | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-5jcgw; blocks: cave-e3ji9; blocks: cave-hvnv8; blocks: cave-tma63; blocks: cave-zrc51; relates-to: cave-zcsl9 |
| cave-hjy2f | \[Chat v1 P2\] Real-authority canonical read conformance | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-3yax4; blocks: cave-ff3j6; blocks: cave-g9d49; blocks: cave-mfcsz; relates-to: cave-0orvs |
| cave-hvnv8 | \[Chat v1 P4\] SDK attachment and confirmed action methods | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-e1kfa; relates-to: cave-zcsl9 |
| cave-hyf4l | Blocked on recast and Charm approval: identity-preservation audio | blocked | 1 | Charm | (not recorded) | (none stored) |
| cave-ilh1h | \[Chat v1 P7 Gate\] Production v1 release accepted | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-563z7; blocks: cave-as76u; blocks: cave-gcb0i; blocks: cave-k0aqq.3; blocks: cave-mbekl; blocks: cave-udcn7; relates-to: cave-j65ie |
| cave-inpy5 | \[Chat v1 P3\] Cave typed SSE resume and reconciliation | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-8ywi2; relates-to: cave-uxlxg |
| cave-iusli | Await tester availability and Apple review: Release chat-only iOS 0.4.3 | blocked | 1 | cody | (not recorded) | (none stored) |
| cave-ixa2o | \[Chat v1 P3\] Send, idempotency, resume, restart, and reconciliation conformance | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-inpy5; blocks: cave-jmav9; blocks: cave-nz54o; blocks: cave-p4ilm; relates-to: cave-uxlxg |
| cave-j65ie | \[Chat v1 P7\] Packaging, compatibility, publishing, and rollout | blocked | 1 | (not recorded) | (not recorded) | relates-to: cave-563z7; relates-to: cave-as76u; relates-to: cave-gcb0i; relates-to: cave-k0aqq; relates-to: cave-mbekl; relates-to: cave-udcn7; until: cave-ilh1h |
| cave-jgo1k | Frontend E2E shard 3/8 dies to a runner shutdown signal, on main as well as PR branches | blocked | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-jmav9 | \[Chat v1 P3\] TypeScript and Rust send/stream clients plus CLI tail | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-8ywi2; relates-to: cave-uxlxg |
| cave-k0aqq | \[Chat v1\] Program: production desktop and developer platform | blocked | 1 | (not recorded) | (not recorded) | relates-to: cave-0567z; relates-to: cave-0orvs; relates-to: cave-fz01p; relates-to: cave-j65ie; relates-to: cave-t7zzu; relates-to: cave-uxlxg; relates-to: cave-z2af3; relates-to: cave-zcsl9; until: cave-ilh1h |
| cave-k0aqq.2 | Reproduce Windows harness quota enumeration denial (Chat OpenCoven/chat#219) | in\_progress | 1 | Val Alexander | https://github.com/OpenCoven/chat/issues/219 | parent-child: cave-k0aqq |
| cave-k0aqq.3 | \[Chat v1 P1\] Align Windows native discovery and fixture roots | in\_progress | 1 | ValAlexander | (not recorded) | discovered-from: cave-k0aqq.2; parent-child: cave-k0aqq |
| cave-kur8m | Patrol BunsDev OpenCoven pull-request queue | open | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-kur8m.16 | Track OpenCoven/feedback#48: fix(mcp): filter private comments for portal details | open | 1 | Val Alexander | https://github.com/OpenCoven/feedback/pull/48 | parent-child: cave-kur8m |
| cave-ltl38 | Deliver the integrated Chat and Coding experience redesign | open | 1 | Val Alexander | (not recorded) | relates-to: cave-kojcl; relates-to: cave-xxc55 |
| cave-m0ex | Verify: live-mic pass in the Tauri shell — native STT end-to-end with a human voice | open | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-mbekl | \[Chat v1 P7\] Prepare Cave Client v1 and Coven client compatibility releases | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-b6wsl; relates-to: cave-j65ie |
| cave-mwehk | Audit and finish native iOS visual consistency | blocked | 1 | Val Alexander | (not recorded) | blocks: cave-xd1b.3; blocks: cave-xd1b.4; blocks: cave-xd1b.5 |
| cave-n9kue | Procure and provision Windows code-signing certificate | open | 1 | CompleteDotTech | (not recorded) | (none stored) |
| cave-nz54o | \[Chat v1 P3\] Cave idempotent conversation and send mutations | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-8ywi2; relates-to: cave-uxlxg |
| cave-o1aw3 | Implement familiar continuity across Cave and Chat | in\_progress | 1 | cody | (not recorded) | (none stored) |
| cave-o8gc4 | \[Chat v1 P6\] Enforce shell, list, stream, route, bundle, and CLI budgets | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-rbikx; relates-to: cave-z2af3 |
| cave-p4ilm | \[Chat v1 P3\] Chat create, send, stream, stop, retry, and recovery loop | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-8ywi2; relates-to: cave-uxlxg |
| cave-p7h8u | Scroll repair merged; TestFlight awaits writer drain | blocked | 1 | nova | (not recorded) | blocks: cave-cgk9v |
| cave-ps8a4 | Project collections: grant a named set of projects as one unit | open | 1 | Val Alexander | (not recorded) | relates-to: cave-1vpy |
| cave-q224t | Make Summoning Circle setup action run | blocked | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-qjvbb | Reduce API pings and load wait times end-to-end | blocked | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-qwnxq | Coven Automations v1 — protocol, operator, migration, troubleshooting docs (GitHub OpenCoven/coven-docs#76) | open | 1 | (not recorded) | https://github.com/OpenCoven/coven-docs/issues/76 | blocks: cave-x28j6 |
| cave-rbikx | \[Chat v1 P5 Gate\] Native lifecycle, offline reads, and tooling verified | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-2m6q0; blocks: cave-f1k8n; blocks: cave-wcpm6; blocks: cave-x8ikk; blocks: cave-x8mcl; relates-to: cave-0567z |
| cave-t59ve | Repair remaining iOS project-context edge cases | open | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-tma63 | \[Chat v1 P4\] Strict rich-content AST and safe renderers | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-e1kfa; relates-to: cave-zcsl9 |
| cave-u68z1 | Verify and land ResearchRun projection PR 5251 | open | 1 | Val Alexander | https://github.com/OpenCoven/coven-cave/pull/5251 | (none stored) |
| cave-udcn7 | \[Chat v1 P7\] Execute OS acceptance, staged rollout, and rollback drill | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-as76u; relates-to: cave-j65ie |
| cave-unam3 | Drive repository to release-ready branch state | blocked | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-usddt | Operationalize familiar access across trusted Cave devices | open | 1 | cody | (not recorded) | relates-to: cave-r1h6 |
| cave-usddt.1 | Needs authorized Mac mini client: prove full-Cave browser access | blocked | 1 | (not recorded) | (not recorded) | parent-child: cave-usddt |
| cave-usddt.2 | Await designated two-device acceptance of landed pairing | blocked | 1 | cody | (not recorded) | parent-child: cave-usddt |
| cave-usddt.3 | Execute remote familiar chat on its authoritative Cave host | open | 1 | (not recorded) | (not recorded) | blocks: cave-usddt.2; parent-child: cave-usddt |
| cave-usddt.4 | Add Connect device journey for existing remote familiars | open | 1 | (not recorded) | (not recorded) | blocks: cave-usddt.3; parent-child: cave-usddt |
| cave-usddt.5 | Prove and release paired Mac remote familiar access | open | 1 | (not recorded) | (not recorded) | blocks: cave-usddt.4; parent-child: cave-usddt |
| cave-uxlxg | \[Chat v1 P3\] Create, send, stream, stop, retry, and recovery | blocked | 1 | Val Alexander | (not recorded) | relates-to: cave-inpy5; relates-to: cave-ixa2o; relates-to: cave-jmav9; relates-to: cave-k0aqq; relates-to: cave-nz54o; relates-to: cave-p4ilm; until: cave-e1kfa |
| cave-v1vz0 | \[Chat v1 P6\] Execute production fault-injection journeys | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-rbikx; relates-to: cave-z2af3 |
| cave-vpn50 | Complete the fix branch landing sweep | in\_progress | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-wcpm6 | \[Chat v1 P5\] Offline and native lifecycle conformance | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-2m6q0; blocks: cave-f1k8n; blocks: cave-x8ikk; blocks: cave-x8mcl; relates-to: cave-0567z |
| cave-wqa0b | Enforce an exclusive maintenance gate for branch and worktree deletion | blocked | 1 | Val Alexander | (not recorded) | blocks: cave-wqa0b.3; blocks: cave-wqa0b.4; discovered-from: cave-fspup; parent-child: cave-urnrx |
| cave-wqa0b.3 | Add fail-closed maintenance pre-write hook to Beads | blocked | 1 | (not recorded) | https://github.com/gastownhall/beads/issues/5193 | parent-child: cave-wqa0b; relates-to: cave-hg7qb |
| cave-wqa0b.4 | Provision GitHub maintenance transaction and gate App | blocked | 1 | Val Alexander | (non-GitHub reference retained privately) | blocks: cave-ei0c2; parent-child: cave-wqa0b |
| cave-x8mcl | \[Chat v1 P5\] Native lifecycle, preferences, shortcuts, links, and diagnostics | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-gylsl; relates-to: cave-0567z |
| cave-xd1b | Cross-platform UI consistency program: components, copy, and placeholders | open | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-xqbs4 | Coven Automations v1 — reusable conformance, contract-drift, roadmap checks (GitHub OpenCoven/.github#2) | open | 1 | (not recorded) | https://github.com/OpenCoven/.github/issues/2 | blocks: cave-hlv.10; blocks: cave-x28j6 |
| cave-yaul2 | Coven Automations v1 — Psyche adapter for automation-triggered orchestration (GitHub OpenCoven/psyche#18) | open | 1 | (not recorded) | https://github.com/OpenCoven/psyche/issues/18 | blocks: cave-x28j6 |
| cave-z2af3 | \[Chat v1 P6\] Security, accessibility, performance, and fault hardening | blocked | 1 | Val Alexander | (not recorded) | relates-to: cave-37pyk; relates-to: cave-90esv; relates-to: cave-fuahq; relates-to: cave-k0aqq; relates-to: cave-o8gc4; relates-to: cave-v1vz0; until: cave-b6wsl |
| cave-zcsl9 | \[Chat v1 P4\] Rich content, attachments, and privileged actions | blocked | 1 | (not recorded) | (not recorded) | relates-to: cave-5jcgw; relates-to: cave-e3ji9; relates-to: cave-hvnv8; relates-to: cave-k0aqq; relates-to: cave-tma63; relates-to: cave-zrc51; until: cave-gylsl |
| cave-zon95 | Finish v0.4.2 physical performance baseline | in\_progress | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-zrc51 | \[Chat v1 P4\] Chat attachment workflow and explicit action confirmation | blocked | 1 | (not recorded) | (not recorded) | blocks: cave-e1kfa; relates-to: cave-zcsl9 |
| cave-zsxpd | Maintainer action: submit GitHub Support case for stuck Actions runs | blocked | 1 | BunsDev | (not recorded) | (none stored) |
| cave-zt59c | Stop repeated macOS App Data prompts from Vault polling | in\_progress | 1 | Val Alexander | (not recorded) | (none stored) |
| cave-0hpzz | Show React source in Canvas | open | 2 | Val Alexander | (not recorded) | blocks: cave-dntw2; blocks: cave-m448b |
| cave-0ihlu | Waiting for repository writers: safe chat auto-archive and self-reports | blocked | 2 | cody | (not recorded) | (none stored) |
| cave-21rp | Resolve Activity Center destination for landed running-activity popover | blocked | 2 | Val Alexander | (not recorded) | (none stored) |
| cave-2idgp | Improve Research Studio podcast scripts and ElevenLabs direction | blocked | 2 | Val Alexander | https://github.com/OpenCoven/coven-cave/issues/4689 | (none stored) |
| cave-33hyb | Recover ResearchRun authority receipt integration PR 5252 | open | 2 | (not recorded) | https://github.com/OpenCoven/coven-cave/pull/5252 | (none stored) |
| cave-3py3z | Blocked on live history trace: Workspace setState warning | open | 2 | Val Alexander | (not recorded) | (none stored) |
| cave-3u4ur | Improve project discovery and explain inherited access | blocked | 2 | cody | (not recorded) | (none stored) |
| cave-44pxd | Design system: define a categorical colour palette | open | 2 | (not recorded) | (not recorded) | (none stored) |
| cave-4cr5o | Add Auto launch and review deliverables before mission rating | blocked | 2 | cody | (not recorded) | (none stored) |
| cave-4noga | Bank design spacing ratchet headroom | blocked | 2 | Cody | (not recorded) | (none stored) |
| cave-4rj6p | Decide Linear authentication and configuration for the Beads visibility bridge | blocked | 2 | (not recorded) | (not recorded) | (none stored) |
| cave-53bml | Chat title row duplicates the context row's runtime and project | open | 2 | (not recorded) | (not recorded) | (none stored) |
| cave-542al | Reduce redundant branches and worktrees with verified retention | blocked | 2 | Val Alexander | (not recorded) | blocks: cave-ylkts |
| cave-58eoq.7 | Retire merged daemon connectivity local units | blocked | 2 | Val Alexander | (not recorded) | blocks: cave-niev5; parent-child: cave-58eoq |
| cave-7jeu7 | Define non-mutating Hermes provider read contract | open | 2 | (not recorded) | (not recorded) | (none stored) |
| cave-7qn9r | Qualify runtime task-continuity suggestions and explicit continuation | open | 2 | (not recorded) | (not recorded) | (none stored) |
| cave-8avq8 | Cody-owned Lazy Frames integration: waiting for writer release | blocked | 2 | cody | (not recorded) | (none stored) |
| cave-9plce | Retire four completed Cody branches from September 12 review | blocked | 2 | Cody | (not recorded) | (none stored) |
| cave-9rwd.7 | Verify iOS Familiar hub accessibility performance and native behavior | open | 2 | (not recorded) | (not recorded) | blocks: cave-9rwd.3; blocks: cave-9rwd.4; blocks: cave-9rwd.5; blocks: cave-9rwd.6; parent-child: cave-9rwd |
| cave-aaj9c | Cross-familiar inbox: no real channel exists — Sage pinging Cody re: no-cross-familiar-inbox blocker | open | 2 | cody | (not recorded) | (none stored) |
| cave-asvd3 | Hermes memory bridge: provider-agnostic read-only source | blocked | 2 | Val Alexander | (not recorded) | blocks: cave-7jeu7 |
| cave-cd6vl | Default familiars to their readable workspace | blocked | 2 | Cody | (not recorded) | (none stored) |
| cave-ceqtd | Modernize familiar inline profile card | in\_progress | 2 | Val Alexander | (not recorded) | (none stored) |
| cave-cwjof | Move the Copilot flow prompt to stdin so a 25k Research brief launches on Windows | open | 2 | CompleteDotTech | (not recorded) | blocks: cave-r3vmj |
| cave-daf0m | Preserve Hermes model capability probe failures in Chat | blocked | 2 | Val Alexander | (not recorded) | (none stored) |
| cave-e5oug | Make performance report history fixture-comparable | in\_progress | 2 | cody | (not recorded) | (none stored) |
| cave-ew021 | OpenClaw install on dev machine has version-skewed schema blocking familiar handoffs | open | 2 | Val Alexander | (not recorded) | (none stored) |
| cave-g54f | Recheck Engineering Sync notification grouping after fire | blocked | 2 | (not recorded) | (not recorded) | (none stored) |
| cave-ges4e | Repair blocking repository documentation conflicts | blocked | 2 | Val Alexander | (not recorded) | (none stored) |
| cave-hgtux | Approval needed to land Branch Curator recency-rule removal | blocked | 2 | Val Alexander | (not recorded) | (none stored) |
| cave-hlv.3 | Bridge Beads with GitHub and Linear visibility | blocked | 2 | Nova | (not recorded) | blocks: cave-4rj6p; parent-child: cave-hlv |
| cave-hois9 | Synchronize chat URL navigation with canonical session context | blocked | 2 | Val Alexander | (not recorded) | (none stored) |
| cave-i9mek | Add blog visual direction controls | open | 2 | Val Alexander | (not recorded) | (none stored) |
| cave-ioefs | Refine saved GitHub viewer into a focused desktop workbench | blocked | 2 | cody | (not recorded) | (none stored) |
| cave-jfe9m | Tighten context-pressure self-report admission | in\_progress | 2 | cody | (not recorded) | (none stored) |
| cave-k0aqq.4 | \[Chat v1 P1\] Investigate WTS SID ambiguity during quarantine | in\_progress | 2 | ValAlexander | (not recorded) | parent-child: cave-k0aqq |
| cave-klxuh | Add PDF highlights and annotations | blocked | 2 | cody | (not recorded) | (none stored) |
| cave-ltl38.10 | Simplify Chat and Coding information architecture | blocked | 2 | (not recorded) | (not recorded) | blocks: cave-3m52u; blocks: cave-ltl38.4; blocks: cave-ltl38.6; blocks: cave-ltl38.8; blocks: cave-xxp9f; parent-child: cave-ltl38 |
| cave-ltl38.11 | Enforce end-to-end Chat and Coding experience quality | blocked | 2 | (not recorded) | (not recorded) | blocks: cave-ltl38.10; blocks: cave-ltl38.7; blocks: cave-ltl38.9; parent-child: cave-ltl38 |
| cave-ltl38.2 | Build the shared streaming-turn model | open | 2 | Val Alexander | (not recorded) | blocks: cave-ltl38.1; parent-child: cave-ltl38; relates-to: cave-20wrn |
| cave-ltl38.3 | Implement calm trustworthy response presentation | blocked | 2 | (not recorded) | (not recorded) | blocks: cave-ltl38.2; parent-child: cave-ltl38; relates-to: cave-20wrn |
| cave-ltl38.5 | Extract a shared session command controller | blocked | 2 | (not recorded) | (not recorded) | blocks: cave-ltl38.3; parent-child: cave-ltl38 |
| cave-ltl38.6 | Connect conversation checkpoints to exact code evidence | blocked | 2 | (not recorded) | (not recorded) | blocks: cave-ltl38.5; parent-child: cave-ltl38 |
| cave-ltl38.7 | Complete the review-first agentic Coding Desk | blocked | 2 | (not recorded) | (not recorded) | blocks: cave-ltl38.6; parent-child: cave-ltl38 |
| cave-ltl38.8 | Unify progressive composer controls | blocked | 2 | (not recorded) | (not recorded) | blocks: cave-ltl38.4; blocks: cave-ltl38.5; blocks: cave-tgl0p; parent-child: cave-ltl38 |
| cave-ltl38.9 | Integrate typed follow-ups and background mission visibility | blocked | 2 | Val Alexander | (not recorded) | blocks: cave-7gryo; blocks: cave-ltl38.3; blocks: cave-onpeg; blocks: cave-rodr5; parent-child: cave-ltl38 |
| cave-m13fh | Add browser-capable modal for Research Desk resources | open | 2 | Val Alexander | (not recorded) | (none stored) |
| cave-me28q | Release v0.4.4 — X Comms room | open | 2 | (not recorded) | (not recorded) | (none stored) |
| cave-niev5 | Reconcile daemon reliability documentation with merged implementation | open | 2 | Val Alexander | (not recorded) | (none stored) |
| cave-onpeg | Blocked on approval: adaptive typed chat follow-ups | blocked | 2 | Val Alexander | (not recorded) | (none stored) |
| cave-q0itj | Enable comprehensive task dependency configuration | blocked | 2 | cody | (not recorded) | blocks: cave-q76cq |
| cave-skeja | Wait for live writers: /image options and GPT Image 2.5 | blocked | 2 | cody | (not recorded) | (none stored) |
| cave-t21pc | X Comms becomes the real X publisher; retire Comms Operations | open | 2 | (not recorded) | (not recorded) | (none stored) |
| cave-t7xqo | Beads: reject a string-valued metadata.coven at write time | blocked | 2 | (not recorded) | https://github.com/gastownhall/beads/issues/6035 | (none stored) |
| cave-vcyh | Production-readiness audit: deferred distribution items | blocked | 2 | Val Alexander | https://github.com/OpenCoven/coven-cave/issues/3807 | blocks: cave-vcyh.3 |
| cave-vcyh.3 | Windows MSI is unsigned (awaiting certificate) | blocked | 2 | CompleteDotTech | (not recorded) | blocks: cave-n9kue; parent-child: cave-vcyh |
| cave-vvr7f | Writer-drain recovery: operator must end the owning run | blocked | 2 | cody | (not recorded) | (none stored) |
| cave-vy5vp | Add Research Desk GitHub repository viewer | open | 2 | Val Alexander | (not recorded) | (none stored) |
| cave-x8la8 | Waiting for iOS writer release: fast-default responsiveness | blocked | 2 | cody | (not recorded) | (none stored) |
| cave-xd1b.4 | Expand the iOS semantic token mirror | blocked | 2 | cody | (not recorded) | blocks: cave-xd1b.2; parent-child: cave-xd1b |
| cave-xd1b.5 | Extract native loading empty and error states | blocked | 2 | (not recorded) | (not recorded) | blocks: cave-xd1b.4; discovered-from: cave-xd1b.2; parent-child: cave-xd1b |
| cave-xd1b.6 | Converge transcript and run rail with OpenCoven UI grammar | open | 2 | (not recorded) | (not recorded) | blocks: cave-xd1b.2; parent-child: cave-xd1b |
| cave-xh17h | Reorganize src/lib into domain directories | open | 2 | Val Alexander | (not recorded) | (none stored) |
| cave-xjr9q | Stage 2: extend project-primary navigation to remaining surfaces | open | 2 | (not recorded) | (not recorded) | (none stored) |
| cave-y48bk | Polish chat selection and broadcast UX | open | 2 | Val Alexander | (not recorded) | (none stored) |
| cave-zq7by | Waiting for writer drain: default Coven neutral backgrounds | blocked | 2 | Val Alexander | (not recorded) | (none stored) |
| cave-00ela | Task orchestration phase 7: retire the Chart Room dependency overlay | blocked | 3 | (not recorded) | (not recorded) | blocks: cave-bmcoe; blocks: cave-llk38 |
| cave-j8noa | Sessions keep raw-adding worktrees into ~/.copilot session-state folders | open | 3 | (not recorded) | (not recorded) | (none stored) |
| cave-o9vdu | Approve scoped fixes for measured chat metadata contrast failures | blocked | 3 | Cody | (not recorded) | (none stored) |
| cave-q0iqe | Flaky: mobile-process-ownership 'backend-root anchor survives supervisor SIGKILL' | blocked | 3 | Cody | (not recorded) | (none stored) |
| cave-qtpao | Chat list: show 'open' only when it materially exceeds active time | blocked | 3 | (not recorded) | (not recorded) | (none stored) |
| cave-r1h6 | Onboarding O3: zero-QR pairing — approve-this-phone flow; optional Bonjour discovery; optional iCloud Keychain (BLOCKED on product calls) | open | 3 | (not recorded) | https://github.com/OpenCoven/coven-cave/pull/4681 | blocks: cave-jr4r; relates-to: cave-usddt |
| cave-y2z1m | Chat surface: cap the decorative backdrop behind text runs | blocked | 3 | copilot-82af4188-backdrop | (not recorded) | (none stored) |

## Ephemeral records

| ID | Title | Legacy status | Priority | Assignee | Existing GitHub reference | Dependencies |
| --- | --- | --- | ---: | --- | --- | --- |
| cave-wisp-xor | Fix running-activity dispatched fallback | blocked | 2 | Val Alexander | (not recorded) | (none stored) |
