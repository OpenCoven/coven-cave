# Windows Host Audit

Windows Host Audit is an optional, session-bound, read-only adapter for
`windows.hyperv.audit.read`. Project access (including **Full**) remains limited
to a registered directory; it never grants Windows host, administrator, or
Hyper-V authority.

The capability is actionable only through the registered
`windows-hyperv-broker` adapter. An approval is rejected when that adapter is
absent; filesystem/runtime fingerprints are not authorization forwarding.

Only a trusted server runtime that has bound an unexpired capability to its
selected Cave conversation may invoke the audit. There is deliberately no
browser endpoint that accepts familiar/session IDs and starts a host process.

The desktop app invokes the separately deployed, install-managed helper at
`%ProgramW6432%\CompleteTech\Coven Cave\coven-host-audit.exe` with one fixed
operation: `hyperv-inventory --format json`. Before every invocation Windows
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
