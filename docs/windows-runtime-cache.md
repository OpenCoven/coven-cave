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

## Generation retention

Each running app leases the generation it serves (#5981). Preparation and the
lease happen in one scope that holds the shared cache lock. The app holds an
exclusive advisory lock on its own file under
`sidecar-runtime/.leases/<generation>/` until it exits, and it records the
generation's last activation time in `last-active`. The OS releases the lock
when the process exits or crashes. The sidecar `node.exe` runs in the app's
kill-on-close job object, so the app's lease covers it as well.

Startup cleanup runs after the sidecar is ready and holds the same cache lock.
It removes incomplete generations and stale extraction staging. For complete
generations it applies the rule Val approved on #5981:

- keep the current generation;
- keep the most recently activated other generation as the rollback copy
  (generations from before leases fall back to their completion marker's age);
- retire any other complete generation only when every lease file in it can be
  locked, which proves no live process holds it. A held lease, an unreadable
  lease directory or an unexpected lock error retains the generation.

After two updates, two generations remain unless a running copy still holds a
third. Explicit uninstall still removes the whole cache; major upgrades skip
that action so the rollback copy survives. `sidecar_archive::tests` and
`sidecar_runtime_retention::tests` run in the Windows startup PR lane with
exact counts.

Revisit the split only after consecutive production candidates measure stable
dependency bytes separately from changed application bytes. A split must keep
both layers deterministic, verified, atomically activated, rollback-safe, and
covered by concurrent-launch and low-space tests.
