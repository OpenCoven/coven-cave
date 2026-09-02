# Security Policy

## Supported Versions

Security fixes are released for the latest published version of Coven Cave.
Upgrade to the [latest release](https://github.com/OpenCoven/coven-cave/releases/latest)
before requesting a backport.

| Release | Security support |
| --- | --- |
| Latest published release | Supported |
| Earlier releases | Not supported |
| Unreleased `main` branch | Reports accepted; no distribution support |

## Reporting a Vulnerability

Report suspected vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/OpenCoven/coven-cave/security/advisories/new).
Do not open a public issue, pull request, or Discord thread.

Include the affected version, platform, impact, reproduction steps, and any
suggested mitigation. Do not include credentials, private user data, or other
people's production data in a report.

We will acknowledge a report within 48 hours, provide an initial assessment
within five business days, and send updates at least every seven days while an
accepted report remains open. We aim to fix confirmed vulnerabilities within
14 days; complex or coordinated fixes may take longer, and we will communicate
the revised timeline.

We will coordinate disclosure after a fix is available. We credit researchers
who responsibly disclose vulnerabilities when they want to be named.

## Scope

Security reports are welcome for:
- Coven Cave desktop, web, sidecar, and iOS surfaces
- Local agent routing, memory, and session isolation
- Authentication and identity handling
- Agent sandbox and execution boundaries
- Update, release, and dependency behavior that creates an exploitable Coven
  Cave vulnerability
- Any mechanism that could allow one agent or user to access another's context

## Out of Scope

- Vulnerabilities in an unmodified third-party service or dependency that do
  not create an exploitable issue in Coven Cave
- Vulnerabilities in model-provider APIs that do not result from Coven Cave's
  integration
- Social engineering, denial-of-service testing, or testing against systems
  and data you do not own or have permission to use

If you are unsure whether a finding is in scope, report it privately and we
will triage it.

## Architectural Security Properties

The following properties are design goals of Coven Cave. A way to violate one
of them is a security report:

1. **Session isolation** — one user's agent context must not be accessible to another user or agent without explicit permission
2. **Memory ownership** — a user's stored memory and context must remain under their control
3. **Agent identity integrity** — a familiar's identity must not be forgeable by another agent or external caller
4. **Execution boundaries** — agent tool calls must not escape their intended scope

### Coven Memory mobile boundary

The standalone iOS memory client reaches Cave's bearer-protected
`/api/mobile/coven-memory` GET routes and `POST /api/mobile-token/refresh` over
the existing Tailscale Serve flow. Tailscale membership alone is not
authorization. Cave validates the mobile marker before configuration or daemon
access, keeps responses private and uncacheable, strips daemon paths, and
exposes no memory mutation route.

Pairing URLs and the persisted mobile access secret are credentials. Never put
them in logs, screenshots, fixtures, issues, PR text, or support transcripts.
The invite remains usable until its shared credential is rotated. The current
credential is shared across paired mobile clients; a lost device requires
global secret rotation and re-pairing, as documented in
[`docs/mobile-memory.md`](docs/mobile-memory.md). Screen capture by a device
owner remains outside the app's control, so review and beta evidence must use
synthetic status-only data.

---

*Last updated: 2026-09-01*
