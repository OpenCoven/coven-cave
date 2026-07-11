# Windows sidecar compression benchmark

The Windows runtime archive uses zstd level 3. The comparison uses the exact
tar payload that the production extractor consumes, so both formats contain
the same paths, metadata, hardlinks, and expanded bytes.

## Current production closure

Measured on the Windows reference machine on 2026-07-10. The source is the
v0.0.173-style production runtime from PR #2911: 24,293 files, 4,018
directories, and 549,137,534 expanded bytes. Compression streamed the same
563,394,560-byte tar through Python 3.14's standard gzip and zstd codecs.
Extraction used Windows inbox bsdtar 3.8.4 with libzstd 1.5.7. Runs were
alternated to reduce filesystem-cache and Defender ordering bias.

| Format | Level | Archive bytes | Compression | Extraction run 1 | Extraction run 2 | Mean extraction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| gzip | 6 | 144,750,679 | 14.207s | 61.161s | 44.013s | 52.587s |
| zstd | 3 | 126,098,931 | 4.890s | 34.473s | 43.290s | 38.882s |

Every extraction produced exactly 24,293 files, 4,018 directories, and
549,137,534 bytes. Zstd was 12.9% smaller, 2.9x faster to compress, and 26.1%
faster to extract on the two-run mean. File creation and real-time scanning
still dominate warm extraction. The canonical uncompressed tar and
activated-tree digests remain the cache's stable identities, so zstd frame
details cannot force needless re-extraction.

## Pruned runtime closure

The final PR2-pruned runtime was measured separately after native `sharp` and
`node-pty` loading passed: 4,942 files, 1,348 directories, and 102,580,489
expanded bytes. The authoritative input was the 32,090,079-byte gzip artifact
with SHA-256 `47344a0e280436a0287975f0ef8c71c7814091e5209f8bf7b1838bf5630c018e`.
It was decompressed once, then the identical 107,253,760-byte tar payload was
recompressed with gzip level 6 and zstd level 3. Extraction used the same
Windows inbox bsdtar and alternated formats over six runs each to expose
filesystem-cache and real-time-scanning variance.

| Format | Level | Archive bytes | Compression | Extraction mean | Extraction median | Six extraction runs |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| gzip | 6 | 32,536,779 | 2.495s | 5.044s | 4.749s | 4.670, 4.828, 6.469, 5.060, 4.669, 4.568s |
| zstd | 3 | 29,077,557 | 0.786s | 5.044s | 4.940s | 5.140, 4.555, 5.821, 4.868, 4.919, 4.961s |

Every extraction produced exactly 4,942 files, 1,348 directories, and
102,580,489 bytes. Extraction is effectively tied on this pruned payload
(the means differ by less than 0.001% while gzip's median is 3.9% lower), confirming
that file creation and scanning dominate decompression. Zstd is still the
measured overall winner: it is 10.6% smaller and 3.2x faster to compress with
no mean extraction penalty. The runtime's split decompression/file-creation
timings preserve that distinction on release machines instead of attributing
the full extraction interval to the codec.

## Decision

Use `server.tar.zst` at zstd level 3. Node 24's built-in zstd codec compresses
the canonical tar directly, and the Rust launcher decodes it in-process. The
manifest identifies `tar.zst` explicitly and retains the same
SHA-256, expanded-byte, file-count, and directory-count integrity checks.

The cache key and current-plus-one-previous retention policy are unchanged.

## Evidence provenance and reproduction

The tables above are the retained record from the 2026-07-10 Windows terminal
session. The individual measurements were transcribed when each command
completed, but the raw console transcript was not retained. No synthetic raw
log is checked in because it would imply provenance that does not exist.

To reproduce the comparison, first materialize the production sidecar payload
with `TAURI_PLATFORM=windows bash scripts/sidecar-bundle.sh`, then extract
`server.tar.zst` once and create one canonical, uncompressed tar from that
directory. Compress that same tar at gzip level 6 and zstd level 3. For each
format, alternate extraction order and use a new empty destination per run:

```powershell
$tar = "$env:SystemRoot\System32\tar.exe"
$payload = Resolve-Path .\sidecar-payload
& $tar -cf .\sidecar.tar -C $payload .
python -c "import gzip,shutil,sys; i=open(sys.argv[1],'rb'); o=gzip.open(sys.argv[2],'wb',compresslevel=6); shutil.copyfileobj(i,o); o.close(); i.close()" .\sidecar.tar .\sidecar.tar.gz
python -c "import compression.zstd as zstd,shutil,sys; i=open(sys.argv[1],'rb'); o=zstd.open(sys.argv[2],'wb',level=3); shutil.copyfileobj(i,o); o.close(); i.close()" .\sidecar.tar .\sidecar.tar.zst

1..6 | ForEach-Object {
    foreach ($archive in @('.\sidecar.tar.gz', '.\sidecar.tar.zst')) {
        $destination = Join-Path $env:TEMP ([Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $destination | Out-Null
        $elapsed = Measure-Command { & $tar -xf $archive -C $destination }
        [pscustomobject]@{ archive = $archive; run = $_; seconds = $elapsed.TotalSeconds }
        Remove-Item -LiteralPath $destination -Recurse -Force
    }
}
```

Before comparing timings, hash the canonical tar used for both formats and
verify that every extracted tree has identical file count, directory count,
logical byte count, and per-file SHA-256 values. Record the Windows tar version
and whether `MsMpEng.exe` was running so later measurements remain comparable.

## Integration contract

Manifest schema 3 combines zstd transport with the content-addressed cache:
canonical payload and full-tree digests, a payload-derived cache key,
interprocess `fs2` locking, free-space preflight, full-file warm validation,
and atomic publication/recovery. Schema 3 prevents the older gzip wire format
from being mistaken for the zstd resource during upgrades.
