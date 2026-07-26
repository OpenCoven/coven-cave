---
name: ritual-dapp-frontend
description: Scaffold Ritual chain and wagmi config, wire wallet connection, then track async precompile jobs through their nine-state machine via on-chain event hooks.
---

# Ritual dApp Frontend

Scaffold Ritual chain and wagmi config, wire wallet connection, then track async precompile jobs through their nine-state machine via on-chain event hooks.

## Use When
- Set up Ritual chain, wagmi config, and providers, then add wallet connection with chain-mismatch handling
- Track an async HTTP or agent precompile call through SUBMITTING to SETTLED using a Zustand state store and event hooks
- Subscribe to JobAdded, JobFulfilled, and JobDelivered events to advance transaction state and render status UI

## Guardrails
- Ritual precompile calls are asynchronous; enforce valid state transitions and treat SETTLED, FAILED, and EXPIRED as terminal
- Categorize errors into wallet, contract, async, and network classes with recoverable user messages
- Set an adequate TTL to avoid EXPIRED jobs and estimate fees including the executor premium before submitting

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
