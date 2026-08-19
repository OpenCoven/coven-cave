# Dependency advisories with no available fix

Most Dependabot alerts close with a version bump. A few cannot, because the
patched version is unreachable from this dependency graph — a transitive crate
is pinned by an upstream generation that has not moved, or has stopped moving
altogether. Those alerts stay open indefinitely, and every session that finds
one re-derives the same constraint from scratch before concluding there is
nothing to do.

This file is where that derivation gets written down once. An entry records
four things and nothing else:

1. **The constraint** — the exact resolver refusal, quoted, not paraphrased.
2. **The evidence** — the commands that produce it, so the next reader can
   re-run them rather than trust this page.
3. **The exposure** — whether the vulnerable code path is reachable from what
   this repo actually builds and ships.
4. **The condition that lifts it** — the specific upstream change that would
   make a bump possible, so the entry can be retired deliberately.

An entry is deleted when its alert closes, not edited into a historical note.
The alert is the source of truth for state; this page only explains it.

---

## Dependabot #18 — `glib` `VariantStrIter` unsoundness

| Field | Value |
|---|---|
| Alert | [#18](https://github.com/OpenCoven/coven-cave/security/dependabot/18) |
| Advisory | [GHSA-wrw7-89jp-8q8g](https://github.com/advisories/GHSA-wrw7-89jp-8q8g) (no CVE) |
| Severity | Moderate |
| Package | `glib` (crates.io), transitive |
| Manifest | `src-tauri/Cargo.lock` |
| Vulnerable | `>= 0.15.0, < 0.20.0` |
| Patched | `0.20.0` |
| Resolved here | `0.18.5` |
| Status | **Not fixable at this Tauri generation.** No exposure identified. |
| Assessed | 2026-08-19 |

### What the advisory is

`VariantStrIter::impl_get` passed `&p` — an immutable reference to a
`*mut libc::c_char` initialized to `NULL` — as a variadic out-argument to
`glib_sys::g_variant_get_child`, which mutates the pointer in place. The
mutability mismatch went uncaught because the C function is variadic. Recent
Rust compilers disregard the unsound write when building with optimizations, so
`CStr::from_ptr` then receives `NULL` and the process dereferences it.

The failure mode is a **crash**, not a disclosure or code-execution primitive,
and it only occurs on a code path that iterates a string-array `GVariant`.

### The blocking constraint

`glib` is not in `src-tauri/Cargo.toml`. It arrives entirely through the
Linux/BSD GTK3 stack that `tauri` and `wry` depend on:

```console
$ cd src-tauri
$ cargo tree -i glib --target x86_64-unknown-linux-gnu
glib v0.18.5
├── atk v0.18.2
│   └── gtk v0.18.2
│       ├── libappindicator v0.9.0
│       │   └── tray-icon v0.23.1
│       │       └── tauri v2.11.2
│       ├── muda v0.19.2
│       ├── tao v0.35.3
│       │   └── tauri-runtime-wry v2.11.2
│       ├── tauri v2.11.2
│       ├── tauri-runtime v2.11.2
│       ├── webkit2gtk v2.0.2
│       │   └── wry v0.55.1
│       └── wry v0.55.1
├── cairo-rs v0.18.5
├── gdk v0.18.2
├── gdk-pixbuf v0.18.5
├── gdkx11 v0.18.2
├── gio v0.18.4
├── gtk v0.18.2
├── javascriptcore-rs v1.1.2
├── libappindicator v0.9.0
├── pango v0.18.3
├── soup3 v0.5.0
└── webkit2gtk v2.0.2
```

A plain `cargo update -p glib` reports `Locking 0 packages` — `0.18.5` is
already the newest release in the `^0.18` range. Forcing the patched version
names the pin directly:

```console
$ cargo update -p glib --precise 0.20.0
error: failed to select a version for the requirement `glib = "^0.18"`
candidate versions found which didn't match: 0.20.0
location searched: crates.io index
required by package `gtk v0.18.2`
    ... which satisfies dependency `gtk = "^0.18"` (locked to 0.18.2) of package `tauri v2.11.2`
    ... which satisfies dependency `tauri = "^2.11.2"` (locked to 2.11.2) of package `app v0.3.7`
```

### Why upgrading Tauri does not help

The pin is not this project's Tauri version. It is the GTK3 Rust binding
generation, which has stopped:

- **`gtk` tops out at `0.18.2`**, published 2024-12-09. That is the highest
  version the crate has ever had. `glib 0.20` belongs to the gtk4-rs
  generation; there is no GTK3 binding release that consumes it.
- **`webkit2gtk 2.0.2`** — the newest, and pinned exactly as `=2.0.2` by `wry`
  — requires `glib ^0.18.0`, `gtk ^0.18.0`, `gio ^0.18.0`.
- **`tauri 2.11.5`**, the latest release at time of writing, still declares
  `gtk ^0.18` for `cfg(any(target_os = "linux", …bsd))`. So does
  `wry 0.56.1`.

Every Tauri v2 release therefore resolves `glib` to the `0.18` line on Linux.
Bumping this project's `tauri` from `2.11.2` to `2.11.5` would change nothing
about this alert.

### Exposure

**Linux/BSD only.** The whole GTK stack sits behind
`cfg(any(target_os = "linux", target_os = "dragonfly", target_os = "freebsd",
target_os = "openbsd", target_os = "netbsd"))`. It is absent from the macOS and
Windows builds, which is what `tauri.conf.json` bundles (`dmg`, `app`, `msi`).
The Linux artifact is real, though — `.github/workflows/release.yml` builds an
AppImage on `ubuntu-22.04` — so "Linux-only" narrows the blast radius rather
than eliminating it.

**No reachable call site was found.** `VariantStrIter` is only constructed by
`glib::Variant::iter_str()`. Scanning the vendored sources of every crate in
the tree that depends on `glib`:

```console
$ grep -rl 'iter_str\|VariantStrIter' ~/.cargo/registry/src/*/<crate>/
```

returns matches in `glib-0.18.5` itself and in **none** of `gtk-0.18.2`,
`gdk-0.18.2`, `gdkx11-0.18.2`, `gdk-pixbuf-0.18.5`, `gio-0.18.4`, `atk-0.18.2`,
`cairo-rs-0.18.5`, `pango-0.18.3`, `soup3-0.5.0`, `javascriptcore-rs-1.1.2`,
`webkit2gtk-2.0.2`, `libappindicator-0.9.0`, `muda-0.19.2`, `tray-icon-0.23.1`,
`tao-0.35.3`, `wry-0.55.1`, `tauri-2.11.2`, `tauri-runtime-2.11.2`, or
`tauri-runtime-wry-2.11.2`.

`src-tauri/src` contains no `glib`, `gio`, or `Variant` usage of its own.

Assessed exposure: **none identified**, against a worst case of a null-pointer
crash in the Linux AppImage.

### What would lift this

Either of:

- **`wry` moving its Linux webview off GTK3.** A `webkit2gtk-6.0` / GTK4
  generation would bring `glib 0.20+` with it. `wry` pins `webkit2gtk =2.0.2`
  exactly, so this is visible as a change to that pin — watch it rather than
  watching `glib`.
- **An upstream backport to the `glib` 0.18 line.** The 0.18 series is not
  receiving fixes, so treat this as unlikely.

Nothing in this repository can accelerate either one. Do **not** hand-edit
`Cargo.lock` to a `glib` version the resolver cannot reach; the build would
fail and the alert would not close.

### Re-checking

```bash
cd src-tauri
cargo tree -i glib --target x86_64-unknown-linux-gnu
cargo update -p glib --dry-run --precise 0.20.0   # expect the refusal quoted above
```

If that refusal no longer names `gtk v0.18.2`, the constraint has moved and
this entry should be re-derived rather than trusted.
