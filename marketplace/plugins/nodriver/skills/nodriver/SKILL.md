---
name: nodriver
description: Drive an undetected Chrome instance via nodriver's async CDP API to navigate, find elements, manage cookies, and handle anti-bot checks.
---

# nodriver

Drive an undetected Chrome instance via nodriver's async CDP API to navigate, find elements, manage cookies, and handle anti-bot checks.

## Use When
- Automate a login and persist the session by saving/loading cookies across runs
- Scrape or fill forms using find(text), select(css), and xpath lookups that double as waits
- Pass a Cloudflare checkbox with verify_cf() or match a template image in the viewport

## Guardrails
- Never use asyncio.run(); use uc.loop().run_until_complete(main())
- Insert `await tab` between rapid interactions to sync DOM state and avoid stale refs
- expert=True increases detectability and verify_cf() needs opencv-python and is English-only

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
