# Windows connected-pipe identity proposal for #6303

Status: proposed, not approved or implemented. Val did not identify an existing binding; the session is preparing the recommendation rather than requiring Val to choose a low-level API. This document does not authorize cross-repository edits, a new native dependency or release changes.

## Recommendation

Reuse the SDK's existing Windows transport security contract and implement or adopt a reviewed native adapter that owns the connected pipe. Do not add a second transport policy, helper daemon or process runner. Keep the connection native until the SDK's security checks finish, then expose a compatible socket adapter for the existing bounded transport. Before implementing a binding, establish its upstream owner and demonstrate a small Windows prototype that inspects the exact handle used for subsequent I/O.

## Current evidence

Cave's `src/lib/coven-daemon.ts` direct HTTP-over-pipe path validates endpoint spelling and local routing but does not inspect the connected peer's ownership. Its existing commentary explicitly distinguishes those checks. Historical #4780 records the same native-credential design problem; closure of that tracker is not implementation evidence.

The live SDK at commit `89685543a62008533237478c31ecce565798ddf6` exposes `CovenWindowsPipeOwnershipAdapter.currentUserIdentity`, `inspect(path)` and `inspectConnected(path, socket)` in [`packages/coven/src/transport-windows.ts`](https://github.com/OpenCoven/sdk/blob/89685543a62008533237478c31ecce565798ddf6/packages/coven/src/transport-windows.ts) (Git blob `f6738c0d606ca4cf1c52c9990f1fb6fb6782259f`). Its socket-access hook validates ownership, owner-only access, server PID, process creation time and endpoint freshness before request I/O. This is an interface and policy seam, not proof that a production native provider exists or that Cave consumes it.

Microsoft documents handle-based [named-pipe server PID inspection](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeserverprocessid) and retrieval of pipe security descriptors through [GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights). Default pipe permissions can include access beyond the creator; a successful connection cannot establish owner-only access. These APIs identify prototype obligations, not a validated adapter implementation.

## Required design properties

- The native adapter owns one operation's connection and handle lifetime. Inspection and later request bytes use that same connection; a path-only probe followed by a fresh connection is insufficient.
- The SDK remains the policy owner. Do not invent the meaning of owner-only access, trusted Windows principals or discovery freshness inside Cave. Resolve any undefined provider policy with the SDK owner.
- Check the current principal, pipe security descriptor, server PID and process creation identity through supported OS interfaces. An unavailable or inconclusive check is unavailable, never a fabricated identity.
- Apply the existing deadline, abort, maximum-header/body and teardown semantics. No request or credential bytes precede successful connected-handle validation. Cancellation releases native handles and pending I/O.
- Avoid Node's private `socket._handle` layout as a compatibility contract. A binding that cannot safely adapt an existing public socket should own connection creation and satisfy the SDK's socket interface.
- Preserve Cave's user data and existing unrelated transports. A native-loader failure needs an explicit diagnostic; it must not silently fall back to unchecked IPC.

## Concrete qualification before adoption

1. Compile an owned Windows fixture and native adapter prototype; record OS/architecture, toolchain, source hashes and binary digests.
2. Prove a valid owner-only pipe succeeds with zero pre-validation request bytes, while foreign ownership, permissive ACLs, inspection failure and process/freshness mismatch fail closed.
3. Replace an endpoint between preparation and connection, exercise concurrent same-path requests and cancel before/during inspection. Prove each receipt refers to the connection actually used, with no handle leak or unauthorized dispatch.
4. Test Unicode, spaces, case aliases, unusual lengths, busy/missing pipes, failed/disconnected servers and bounded retry/deadline behavior. Keep first failures and exact non-skipped test counts.
5. Review dependency, packaging and compatibility costs under #6119 before changing production routing. If the producer's pipe permissions fail the reviewed contract, propose the exact producer repair to its owner; do not change the daemon under #6303.

The current three-case occupancy test covers only real connection cleanup, endpoint preservation and missing-pipe handling. It is wired for the Windows lane but has run on macOS only. It does not satisfy any connected-owner or ACL acceptance above. #6303 stays incomplete until the remaining inventory, per-boundary contracts and Windows proof are delivered.
