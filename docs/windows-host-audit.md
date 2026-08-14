# Windows Host Audit

Windows Host Audit is an optional, session-bound, read-only adapter for
`windows.hyperv.audit.read`. Project access (including **Full**) remains limited
to a registered directory; it never grants Windows host, administrator, or
Hyper-V authority.

This draft ships source and typed runtime scaffolding only. The capability is
currently unavailable: no grant can be approved and no audit can be invoked.
It becomes actionable only in a later release after the packaged helper and
installer-owned manifest have been independently integrity/signing-verified
and register `windows-hyperv-broker`. Filesystem/runtime fingerprints are not
authorization forwarding.

When the separately verified package is available, only a trusted server
runtime that has bound an unexpired capability to its selected Cave
conversation may invoke the audit. There is deliberately no browser endpoint
that accepts familiar/session IDs and starts a host process.

## Future activation-release requirements

The future activation release must package a real helper and an
installer-owned, ACL-protected `coven-host-audit.manifest.json` beside the Cave
executable. It must prove containment, ownership, ACL, and reparse-point safety
for both manifest and helper, while supporting all-user installations on
non-`C:` drives without trusting PATH, environment variables, the working
directory, registry, or a browser request. The manifest must name the helper
and native PowerShell executable and validate both as absolute Windows
executables before use.

That release must restrict the helper to `hyperv-inventory --format json` and,
before every invocation, require an Authenticode `Valid` chain and the expected
`CN=CompleteTech` publisher subject. Missing, altered, expired, or differently
signed helpers must fail closed. The helper must request UAC only when that
inventory needs elevation, return only host, VM, switch, checkpoint, VHD-chain,
and integration-service inventory, and reject arbitrary PowerShell, scripts,
VM lifecycle actions, checkpoint changes, disk writes, network changes, and
credential access.

Signing verifies publisher identity and artifact integrity; it does not grant
this capability, bypass UAC, or turn a project grant into host authority. The
recommended release integration is Microsoft Azure Artifact Signing, which
uses a managed signing service and supports CI/CD integration. See Microsoft’s
[Artifact Signing overview](https://learn.microsoft.com/azure/artifact-signing/overview)
and [Azure Artifact Signing pricing](https://azure.microsoft.com/pricing/details/artifact-signing/).

The signed helper and installer should use the same CompleteTech publisher
identity. The signing credential belongs in the managed signing service, never
in the Cave repository, installer source, or CI checkout.
