# Reviewed CLI install verification

[Issue #6164](https://github.com/OpenCoven/coven-cave/issues/6164) updates the
reviewed installation target to Coven CLI 0.4.10. The minimum compatible
version remains 0.4.0. Install and repair use the existing reviewed manifest
and lifecycle; opening Cave does not upgrade an existing installation.

Native [PR #794](https://github.com/OpenCoven/coven/pull/794) already separated
the standalone Memory dashboard from the CLI's default dependencies. Cave's
released-daemon canary already uses 0.4.10 through
[PR #6047](https://github.com/OpenCoven/coven-cave/pull/6047). This change adopts
that released package in setup without adding another module or installer.

## Observed installation footprint

On 2026-10-21, production browser setup installed each reviewed version into
a fresh synthetic home on Apple M5 Max, Darwin 25.6 arm64, 128 GiB RAM, using
managed Node 24.18.0 and Chromium 151.0.7922.34. Counts sum regular-file logical
bytes and exclude symlinks, directories, npm caches and OS allocation effects.

| Installed subtree | CLI 0.4.0 | CLI 0.4.10 |
| --- | ---: | ---: |
| Managed npm prefix | 365,518,250 bytes / 11,926 files | 32,421,185 bytes / 7 files |
| Managed Node tree | 193,337,140 bytes / 4,703 files | 193,337,140 bytes / 4,703 files |

The npm prefix shrank by 333,097,065 logical bytes (91.1%). The old tree
included Next, its native compiler and the standalone Memory dashboard;
the new tree contains the CLI wrapper and the host's native CLI package.
The five published wrapper/platform version, integrity and tarball records
match the existing release-canary lockfile and registry metadata.

Baseline Cave source was `4fd4ceed945b664ff886a9cdc49511919750ac5c`, build
`nuGAs2KGR0OB94D-3NFkw`. Candidate source was
`7bde4ca3f594276d3de3a2d30d78b32949d969ba`, build
`giGG-oAOfBeKM9NtDK60D`. These builds have different main-branch bases;
the comparison measures installed package files, not frontend performance.
Candidate production build, existing size budgets, full typecheck and the
14 relevant canonical test files passed, including the API contracts.

## Actual setup and absence checks

The candidate's real **Set up Cave** action installed the pinned package,
completed all three local setup stages and returned successful daemon,
familiars and memory responses. Native status and Cave agreed on PID, socket
and start identity. After dismissal, stale daemon/familiar errors cleared.

A synthetic existing familiar memory note remained byte-identical and
readable through Cave's memory API without the companion. A separate Cave
state marker also survived setup and cleanup. `coven memory open` exited
promptly with the existing explicit companion-install instruction. The
standalone dashboard remains available through its separate installation;
this does not make Cave's Memories room optional.

Normal daemon stop succeeded. Independent checks found every recorded owned
process group and intended daemon PID absent, the server port closed, the
socket absent and both marker hashes unchanged. No user profile, credentials
or real daemon participated.

## Evidence limits and maintenance

There was one fully asserted fresh browser profile per version. The candidate
observed setup completion at 9.481 seconds and UI completion at 10.268 seconds;
network and filesystem caches were uncontrolled, so these are observations,
not a causal speedup or latency budget. Packaged native, mobile, Windows
runtime, provider execution, upgrade migration and sustained operation were
not established by this experiment. The released CLI does not contain
unreleased native fixes under the parent program.

Exact reports, scripts, screenshots and fixture locations are recorded on
issue #6164. Candidate report SHA-256:
`8bcb8bf9aab57f45d59766909525a02b7496f16c101a3b35a248d33537bb3677`.
Keep future version and integrity updates together and re-run the installer
and released-daemon checks. Reverting this manifest update restores the old
installation target and its larger implicit dependency tree; it does not
restore or alter user data.
