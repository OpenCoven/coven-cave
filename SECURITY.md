# Security Policy

## Supported Versions

Use this section to tell people about which versions of your project are
currently being supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 5.1.x   | :white_check_mark: |
| 5.0.x   | :x:                |
| 4.0.x   | :white_check_mark: |
| < 4.0   | :x:                |

## Reporting a Vulnerability

Use this section to tell people how to report a vulnerability.

Tell them where to go, how often they can expect to get an update on a
reported vulnerability, what to expect if the vulnerability is accepted or
declined, etc.

---

## OpenCoven Security Disclosure Addendum

## Security Policy

### Reporting a Vulnerability

If you discover a security vulnerability in OpenCoven, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Contact the maintainers directly:
- Discord: https://discord.gg/OpenCoven (DM @BunsDev)
- Or open a GitHub Security Advisory on the repository

We will acknowledge receipt within 48 hours and aim to address confirmed vulnerabilities within 14 days.

### Scope

Security reports are welcome for:
- OpenCoven core harness and routing logic
- OpenTrust memory and session substrate
- Authentication and identity handling
- Agent sandbox and execution boundaries
- Any mechanism that could allow one agent or user to access another's context

### Out of Scope

- Issues in third-party dependencies (report to the dependency maintainer)
- Issues in model provider APIs (report to the provider)

### Our Commitment

We take security seriously because OpenCoven handles personal context and agent execution on behalf of users. We will credit researchers who responsibly disclose vulnerabilities (with their permission).

---

## Architectural Security Properties

The following properties are design goals of OpenCoven. If you find a way to violate them, that's a security report:

1. **Session isolation** — one user's agent context must not be accessible to another user or agent without explicit permission
2. **Memory ownership** — a user's stored memory and context must remain under their control
3. **Agent identity integrity** — a familiar's identity must not be forgeable by another agent or external caller
4. **Execution boundaries** — agent tool calls must not escape their intended scope

---

*Last updated: 2026-07-04*
