#!/usr/bin/env bash
# Run Playwright inside the official Playwright image on a CI runner (#6191).
#
# Installing the browsers' system packages with apt on the runner (#5722) kept
# failing: the Ubuntu mirror sometimes trickles WebKit's media and graphics
# packages, and two bounded 15-minute attempts still did not get through. The
# official image already carries those packages and the browsers for this
# exact Playwright version, so apt never runs. Only the image pull touches the
# network, and it gets the same bounded, retried attempts. The pull happens
# here rather than through a job-level `container:`, where GitHub pulls the
# image with no deadline we control.
#
# The host keeps its checkout, Node, pnpm and node_modules. They are mounted at
# their own paths and run as the runner's user, so the container runs the same
# toolchain against the same tree; only the browsers and their libraries come
# from the image.
#
# Usage: playwright-ci-image.sh pull
#        playwright-ci-image.sh run <command>...
# Env:   PLAYWRIGHT_IMAGE_ATTEMPTS (default 2), PLAYWRIGHT_IMAGE_TIMEOUT (default 10m)
set -euo pipefail

usage() { echo "usage: $0 pull | run <command>..." >&2; exit 2; }
[ "$#" -gt 0 ] || usage

# The image tag follows the installed @playwright/test, so its browsers always
# match the test runner's expected revisions.
version="$(node -p "require('@playwright/test/package.json').version")"
image="mcr.microsoft.com/playwright:v${version}-noble"

pull() {
  local attempts="${PLAYWRIGHT_IMAGE_ATTEMPTS:-2}"
  local limit="${PLAYWRIGHT_IMAGE_TIMEOUT:-10m}"
  local attempt=1
  while true; do
    echo "::group::Pull $image, attempt $attempt of $attempts (limit $limit)"
    if timeout --kill-after=30s "$limit" docker pull --quiet "$image"; then
      echo "::endgroup::"
      return 0
    fi
    echo "::endgroup::"
    if [ "$attempt" -ge "$attempts" ]; then
      echo "::error::Playwright image $image did not pull in $attempts attempts of $limit each (#6191)."
      exit 1
    fi
    echo "::warning::Pulling $image attempt $attempt failed or exceeded $limit; retrying (#6191)."
    attempt=$((attempt + 1))
  done
}

run() {
  [ "$#" -gt 0 ] || usage

  # Mount every host directory the command needs at its own path: the runner
  # home (workspace, pnpm, caches), the job's temp directory, and Node's
  # install prefix. A path inside one already mounted is skipped, because
  # Docker refuses a duplicate mount point.
  local node_prefix
  node_prefix="$(dirname "$(dirname "$(command -v node)")")"
  local mounts=()
  local candidate existing covered
  for candidate in "$HOME" "$PWD" "${RUNNER_TEMP:-}" "$node_prefix"; do
    [ -n "$candidate" ] && [ -d "$candidate" ] || continue
    covered=""
    for existing in ${mounts[@]+"${mounts[@]}"}; do
      case "$candidate/" in "$existing"/*) covered=1 ;; esac
    done
    [ -n "$covered" ] || mounts+=("$candidate")
  done
  local volume_args=()
  for existing in ${mounts[@]+"${mounts[@]}"}; do volume_args+=(-v "$existing:$existing"); done

  # Forward the job's environment by name (Docker reads each value from this
  # process, so multi-line values survive). The image's own browser path wins.
  local env_args=() name
  while IFS= read -r name; do
    env_args+=(-e "$name")
  done < <(compgen -e | grep -E '^(CI|HOME|PATH|SHELL|USER|LOGNAME|LANG|TZ|GITHUB_.+|RUNNER_.+|NEXT_PUBLIC_.+|CAVE_.+|COVEN_.+|NODE_.+|PNPM_.+|PLAYWRIGHT_.+|npm_config_.+)$' | grep -vx PLAYWRIGHT_BROWSERS_PATH || true)

  exec docker run --rm --init --ipc=host --network=host \
    --user "$(id -u):$(id -g)" \
    -v /etc/passwd:/etc/passwd:ro -v /etc/group:/etc/group:ro \
    ${volume_args[@]+"${volume_args[@]}"} \
    ${env_args[@]+"${env_args[@]}"} \
    -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    -w "$PWD" \
    "$image" "$@"
}

case "$1" in
  pull) [ "$#" -eq 1 ] || usage; pull ;;
  run) shift; run "$@" ;;
  *) usage ;;
esac
