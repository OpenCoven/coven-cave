# Shorter onboarding design

Val approved the interactive concept and authorized implementation and protected merge to main on 12 November 2026. Canonical work: OpenCoven/coven-cave#6485. The visual direction was reviewed in an interactive prototype in this conversation; the contracts below are its durable implementation reference. This document records that approved direction and the implementation decisions needed to make it real; implementation awaits the scoped worktree exception.

## Outcome

Move from local setup to one configured assistant, an explicitly scoped project, and a useful real conversation through three visible stages. Remove the compulsory simulated approval, Stop/Retry and verification quiz. Keep methodology guidance available as optional help, and teach controls beside real activity.

## Approaches considered

Visual polish alone would retain the long tutorial and its execution gate. Shortening its text would reduce reading while retaining the same interruption. Val approved the third approach: replace the required tutorial with a three-step flow and contextual guidance, then iterated the actual prototype to approve the fuller layout, assistant chooser, Read/Full options and polished first chat.

## Presentation

Use a dedicated, spacious but purposeful viewport with horizontal progress, one primary action, semantic graphite surfaces and lavender presence. The “Meet the others” chooser reveals actual available familiars and supported runtimes in selectable cards. The project stage offers existing projects, a dedicated starter folder, or an actual folder picker, followed by mutually exclusive Read and Full access cards. The first chat presents editable starter requests, the selected familiar/project/runtime, the effective access mode and a labeled send action.

Re-express the prototype through Cave tokens, Phosphor icons, existing buttons/selects, native folder handling, focus trapping and announcers. It is a reference, not an HTML implementation to vendor. Adapt fluid sizing to actual viewport and font scaling; retain narrow/touch/keyboard and reduced-motion behavior. Do not add screenshots of fictional files to production. A real project preview must derive from authorized evidence, or explicitly identify itself as the starter example.

## Real behavior

Reuse existing runtime installation and familiar creation APIs. Existing familiars keep their exact identities and bindings, including remote runtimes. A passive executable/configuration probe means configured or available, not authenticated or provider-connected. Show sign-in/recovery when the selected runtime requests it, and recognize first success only after an actual completed response.

Project registration and grants remain distinct operations. Selecting a project or access card makes no grant. The primary project action states its exact consequence and uses the existing human-authorized grant endpoint with the direct grant as a compare-and-set precondition. Read means no file modifications through Cave; Full permits project-file changes subject to runtime and approval controls. Existing inherited/effective grants remain visible; the UI cannot claim a weaker effective permission than the authority layer enforces. Switching actor/project clears uncommitted access consent. Failures retain project registration and allow retry without duplicating projects or dispatch.

Save exact project/familiar IDs and permission mode, not a transient roster position. Validate membership, effective grants and runtime at the current production boundaries. Repair removed, revoked or unavailable selections without silently widening or trimming scope. Preserve existing multi-familiar defaults in an advanced disclosure rather than replacing them with one actor during an upgrade.

## Progress and compatibility

Introduce a versioned short-setup state while preserving strict parsing of legacy version-one progress. New setup needs assistant selection and explicit context/access review; tutorial practice remains separate and is never fabricated as completed. Existing completed users retain their defaults and are not forced through onboarding again. Interrupted old guides resume into the short path with saved concrete choices retained. Every mutation checks the persisted revision.

Local bootstrap stops after its actual local-component work, then hands off to the assistant stage rather than presenting a separate runtime-selection wizard. Setup dismissal permits browsing and preserves progress; initiating an actual run still requires concrete valid context and explicit access. No learner quiz is required for execution.

The first-chat presentation must use the production chat/composer/send flow and its actual activity, Stop, approval and response behavior. Starter cards fill an editable draft; selecting one never automatically sends. Setup completion is distinct from the first-response stamp. Existing conversations and deep-link drafts remain bound to their own explicit context.

## Verification and delivery

Cover new setup, completed legacy users, interruption/restart, cross-window revision races, runtime unavailability, Read/Full selection and stale grants, actor/project changes, first-chat drafts, failed sends and Stop. Run affected behavior, API and model tests, typecheck, lint/token gates, test wiring and production build. Inspect rendered production UI at desktop/narrow sizes, dark/light modes, keyboard and reduced motion using isolated synthetic state. A real provider response and native/physical-device acceptance are separate evidence classes and must be reported as such.

Commit and push only the issue-owned implementation, review all exact-head PR feedback and checks, and squash-merge through the protected path with human attribution preserved. Preserve the worktree with an explicit owner and reason afterward. Release and installation are separate work.
