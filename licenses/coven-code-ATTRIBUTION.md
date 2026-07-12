# Attribution

**Coven Code** is a GPL-3.0 derivative of [Claurst](https://github.com/Kuberwastaken/claurst)
by Kuber Mehta / Kuberwastaken, licensed under the GNU General Public License v3.0.

The original Claurst license is preserved in full in `LICENSE.md`.

## Changes from upstream (Claurst)

- Product name rebranded to **Coven Code** (`coven-code` binary)
- npm package renamed to `@opencoven/coven-code`
- Data/cache directories changed from `~/.claurst/` → `~/.coven-code/`
- Environment variable prefix changed from `CLAURST_` → `COVEN_CODE_`
- User-Agent strings updated to `coven-code/<version>`
- System prompt identity updated to reflect OpenCoven fork
- Repository and homepage URLs updated to OpenCoven GitHub
- Landing page (`index.html`), docs, and installer scripts rebranded
- Mascot renamed from "Rustle" to "Rune" (internal Rust module and pose names now use companion/mascot terminology)
- ACP server identity updated to `coven-code`
- Share viewer URL updated to `opencoven.github.io/coven-code/session/`
- `CNAME` file removed (upstream pointed to `claurst.kuber.studio`)
- `.gitignore` entry updated from `.claurst/` to `.coven-code/`
- Devcontainer updated to `coven-code` volume names

## Internal Crate Name Boundary

The following Rust crate names are **intentionally preserved** from upstream:

- `claurst` (Cargo package name for the binary crate; binary output is `coven-code`)
- `claurst-core`, `claurst-api`, `claurst-tui`, `claurst-tools`, `claurst-query`
- `claurst-commands`, `claurst-mcp`, `claurst-bridge`, `claurst-buddy`
- `claurst-plugins`, `claurst-acp`

Rationale: These names appear in `[package] name` fields and across dozens of
`[dependencies]` sections in `Cargo.toml` files throughout the workspace. Renaming
them would require updating every `use claurst_*` import and every `Cargo.toml`
dependency reference — a high-risk bulk change with no user-visible benefit.
This boundary makes `git merge upstream/main` low-friction.

If you fork this repo and want to do a full internal rename, start with
`src-rust/Cargo.toml` workspace dependencies, then each crate's `[package] name`,
then all `use claurst_*` imports across the codebase.

All original copyright notices, the GPL-3.0 license text, and upstream attribution
remain intact and unmodified. Source code is available at:
https://github.com/OpenCoven/coven-code

This fork is maintained by OpenCoven / Valentina (Soul Protocol LLC).
