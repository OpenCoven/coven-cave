# Windows Host Audit

Windows Host Audit is an optional, session-bound, read-only adapter for
`windows.hyperv.audit.read`. Project access (including **Full**) remains limited
to a registered directory; it never grants Windows host, administrator, or
Hyper-V authority.

The desktop app invokes the separately deployed `coven-host-audit.exe` helper
with one fixed operation: `hyperv-inventory --format json`. The helper is
responsible for requesting UAC only when that inventory needs elevation. It may
return host, VM, switch, checkpoint, VHD-chain, and integration-service
inventory. It must reject arbitrary PowerShell, scripts, VM lifecycle actions,
checkpoint changes, disk writes, network changes, and credential access.

Signing verifies publisher identity and artifact integrity; it does not grant
this capability, bypass UAC, or turn a project grant into host authority. The
recommended release integration is Microsoft Azure Artifact Signing, which
uses a managed signing service and supports CI/CD integration. See Microsoft’s
[Artifact Signing overview](https://learn.microsoft.com/azure/artifact-signing/overview)
and [Azure Artifact Signing pricing](https://azure.microsoft.com/pricing/details/artifact-signing/).

The signed helper and installer should use the same CompleteTech publisher
identity. The signing credential belongs in the managed signing service, never
in the Cave repository, installer source, or CI checkout.
