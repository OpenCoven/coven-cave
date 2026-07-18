# Windows runtime cache design

The Windows runtime uses one deterministic, content-addressed archive layer.
The cache key contains the archive schema and canonical payload digest, while a
separate tree digest authenticates every activated file on reuse.

## Layering decision

Measurements taken before this change did not justify splitting stable
dependencies from release-specific application files:

| Payload | Files | Expanded bytes | Compressed bytes | Compression/build | Extraction |
| --- | ---: | ---: | ---: | ---: | ---: |
| Production runtime used for cache validation | 21,916 | 522,443,366 | 137,268,806 gzip | 123.97 s cold / 84.84 s warm archive build | not isolated in this PR |
| Final pruned runtime closure | 4,942 | 102,580,489 | 32,090,079 source gzip; 29,077,557 zstd-3 candidate | 2.495 s gzip-6; 0.786 s zstd-3 | 5.044 s mean for both formats across six alternating runs |

The final closure reduces the expanded payload by about 80 percent before
introducing a second archive, manifest, activation transaction, rollback unit,
or lock domain. There is not yet consecutive-release churn evidence showing
that a dependency layer would avoid enough transfer or preparation work to
offset that complexity. The current schema therefore keeps one atomic layer
and reuses it across app versions whenever its payload digest is unchanged.

Startup cleanup holds the shared cache lock and removes only incomplete
generations and stale extraction staging directories. It retains every
structurally complete content-addressed generation because, without explicit
process leases, an older concurrently running app may still be loading files
from any one of them. Explicit uninstall owns complete-cache reclamation; this
trades bounded cache growth between uninstalls for safe rollback and concurrent
upgrade behavior.

Revisit the split only after consecutive production candidates measure stable
dependency bytes separately from changed application bytes. A split must keep
both layers deterministic, verified, atomically activated, rollback-safe, and
covered by concurrent-launch and low-space tests.
