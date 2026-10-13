#!/usr/bin/env bash
# Install Playwright's browsers and their system packages on a CI runner (#5722).
#
# `playwright install --with-deps` ran apt and the browser downloads as one
# unbounded step. On some runners the apt mirror trickles WebKit's media and
# graphics packages at ~80 KB/s, and that one step took ~25 of the E2E job's
# 30 minutes, so shards were cancelled before or during the tests with nothing
# failing. Here the system packages get a bounded attempt that is retried (a
# retry usually lands on a healthy connection), and the browser binaries come
# from the workflow's cache when it has them.
#
# Usage: install-playwright-ci.sh <browser>...
# Env:   PLAYWRIGHT_DEPS_ATTEMPTS (default 2), PLAYWRIGHT_DEPS_TIMEOUT (default 15m)
set -euo pipefail

[ "$#" -gt 0 ] || { echo "usage: $0 <browser>..." >&2; exit 2; }
attempts="${PLAYWRIGHT_DEPS_ATTEMPTS:-2}"
limit="${PLAYWRIGHT_DEPS_TIMEOUT:-15m}"

attempt=1
while true; do
  echo "::group::Playwright system packages, attempt $attempt of $attempts (limit $limit)"
  if timeout --kill-after=30s "$limit" pnpm exec playwright install-deps "$@"; then
    echo "::endgroup::"
    break
  fi
  echo "::endgroup::"
  if [ "$attempt" -ge "$attempts" ]; then
    echo "::error::Playwright system packages did not install in $attempts attempts of $limit each (#5722)."
    exit 1
  fi
  echo "::warning::Playwright system packages attempt $attempt failed or exceeded $limit; retrying (#5722)."
  # A killed apt-get can leave dpkg mid-transaction and its lock held, which
  # would fail the next attempt immediately. Stop stragglers and repair.
  sudo pkill -x apt-get || true
  sudo pkill -x dpkg || true
  sudo dpkg --configure -a || true
  attempt=$((attempt + 1))
done

# Browser binaries: a cache hit makes this a no-op version check.
pnpm exec playwright install "$@"
