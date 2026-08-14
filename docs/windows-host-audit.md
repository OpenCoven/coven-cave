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

The desktop app resolves the helper and Windows PowerShell paths from the
installer-owned, ACL-protected `coven-host-audit.manifest.json` located beside
the Cave executable. This supports all-user installations on non-`C:` drives
without trusting PATH, environment variables, the working directory, registry,
or a browser request. The manifest names the separately deployed helper and
the native PowerShell executable; both are validated as absolute Windows
executables before use. The helper accepts one fixed operation:
`hyperv-inventory --format json`. Before every invocation Windows
must report an Authenticode `Valid` chain and the expected `CN=CompleteTech`
publisher subject; any
missing, altered, expired, or differently signed helper fails closed. The
helper is responsible for requesting UAC only when that inventory needs
elevation. It may return host, VM, switch, checkpoint, VHD-chain, and
integration-service inventory. It must reject arbitrary PowerShell, scripts,
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
