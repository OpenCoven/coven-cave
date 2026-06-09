#!/usr/bin/env bash
# Render a standardized GitHub release body for a CovenCave tag.
#
# Usage:
#   scripts/release-notes.sh v0.0.55 [previous-tag]
#
# Prints the rendered markdown body to stdout. Tries the CHANGELOG.md entry
# for the version first, and falls back to a short bullet list of commit
# subjects between the previous tag and this one when no entry exists. The
# previous tag is auto-detected via `git tag --sort=-version:refname` when
# the second argument is omitted.
#
# Designed to be run both in CI (release.yml's checksums job re-renders the
# body after all artifacts have uploaded) and locally for backfilling old
# releases via `gh release edit <tag> --notes-file -`.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <vX.Y.Z> [previous-tag]" >&2
  exit 2
fi

VERSION="$1"
VER_NUM="${VERSION#v}"
PREV="${2:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHANGELOG="$ROOT/CHANGELOG.md"
REPO="${COVEN_REPO_SLUG:-OpenCoven/coven-cave}"

# ── Resolve the previous tag ────────────────────────────────────────────────
# Exclude pre-release suffixes (rc*, alpha*, etc.) so the "compare" link
# always lines up with the prior stable cut.
if [ -z "$PREV" ]; then
  PREV="$(
    cd "$ROOT" \
      && git tag -l 'v[0-9]*' --sort=-version:refname \
      | grep -Ev -- '-[a-zA-Z]' \
      | awk -v cur="$VERSION" '$0==cur{f=1; next} f{print; exit}'
  )"
fi

# ── Pull the CHANGELOG section for this version (between two `## [x.y.z]`) ──
# Use literal-prefix matching (index == 1) so we don't fight bash/awk regex
# escaping — the `.` characters in semver are regex metachars.
section="$(
  awk -v marker="## [$VER_NUM]" '
    index($0, marker) == 1 { found=1; next }
    found && /^## / { exit }
    found { print }
  ' "$CHANGELOG" 2>/dev/null || true
)"

# ── arch-suffixed DMG names landed in v0.0.54 (#269) ────────────────────────
# Treat anything >= 0.0.54 as having two DMGs (x86_64 + aarch64); earlier
# tags shipped a single CovenCave-v<X.Y.Z>.dmg.
arch_split=false
IFS=. read -r _maj _min _patch <<EOF
$VER_NUM
EOF
if [ "${_patch:-0}" -ge 54 ] || [ "${_min:-0}" -gt 0 ]; then
  arch_split=true
fi

# ── Body ────────────────────────────────────────────────────────────────────
printf '## What'"'"'s new in %s\n\n' "$VERSION"

if [ -n "${section// /}" ]; then
  # Drop leading blank lines from the awk capture.
  printf '%s\n' "$section" | awk 'started || NF { started=1; print }'
elif [ -n "$PREV" ]; then
  echo "Commits since [\`$PREV\`](https://github.com/$REPO/releases/tag/$PREV):"
  echo
  (
    cd "$ROOT"
    git log --no-merges --pretty=format:'- %s' "$PREV".."$VERSION" 2>/dev/null \
      | sed 's/ (#\([0-9]\+\))$/ ([#\1](https:\/\/github.com\/'"$(echo "$REPO" | sed 's,/,\\/,g')"'\/pull\/\1))/'
  )
  echo
else
  echo "Initial release."
  echo
fi

cat <<INSTALL

## Install

INSTALL

if [ "$arch_split" = "true" ]; then
  cat <<INSTALL_NEW
- **macOS (Apple Silicon):** download \`CovenCave-$VERSION-aarch64.dmg\`, open it, drag CovenCave.app to Applications.
- **macOS (Intel):** download \`CovenCave-$VERSION-x86_64.dmg\`, open it, drag CovenCave.app to Applications.
INSTALL_NEW
else
  cat <<INSTALL_LEGACY
- **macOS:** download \`CovenCave-$VERSION.dmg\`, open it, drag CovenCave.app to Applications.
INSTALL_LEGACY
fi

cat <<INSTALL_REST
- **Linux:** download the AppImage asset, \`chmod +x CovenCave_*.AppImage\`, then run it.
- **Windows:** download the \`.msi\` and double-click to install.

## Verify checksums

\`\`\`bash
shasum -a 256 -c SHA256SUMS
\`\`\`

INSTALL_REST

if [ -n "$PREV" ]; then
  printf '**Full changelog:** https://github.com/%s/compare/%s...%s\n' \
    "$REPO" "$PREV" "$VERSION"
else
  printf '**Full changelog:** https://github.com/%s/commits/%s\n' \
    "$REPO" "$VERSION"
fi
