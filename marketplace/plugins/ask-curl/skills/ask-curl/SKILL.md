---
name: ask-curl
description: Describe the HTTP request you want, review the generated cURL command, and run it with secrets injected at runtime via op run.
---

# Ask cURL

Describe the HTTP request you want, review the generated cURL command, and run it with secrets injected at runtime via op run.

## Use When
- Build a GET or POST cURL command from a plain-English description with correct headers, auth, and body
- Inject API tokens at runtime from 1Password op:// references so secrets never touch shell history or disk
- Chain multi-step flows such as fetching an OAuth token then calling a protected endpoint, piping JSON through jq

## Guardrails
- Never print, log, or write tokens to files; use op read inline or op run and strip Authorization headers from history
- Always confirm before running POST, PUT, PATCH, or DELETE by showing the command first
- Set --max-time 30 on every request and warn on any non-HTTPS URL except localhost

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
