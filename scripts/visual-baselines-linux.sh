#!/usr/bin/env bash
# Regenerates the Linux visual baselines inside the same Playwright image CI's e2e job
# uses, so fonts and rendering match CI exactly. Works on a copy of the repo (never the
# host's node_modules) and copies only the *-linux.png baselines back.
#
#   pnpm test:visual:linux              # rewrite baselines that changed
#   UPDATE=all pnpm test:visual:linux   # rewrite every baseline (e.g. a small header change)
#   UPDATE=all GREP=appearance pnpm test:visual:linux   # only the tests matching GREP
set -euo pipefail

IMAGE="mcr.microsoft.com/playwright:v1.64.1-noble"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if command -v cygpath >/dev/null; then ROOT="$(cygpath -m "$ROOT")"; fi # Git Bash on Windows

MSYS_NO_PATHCONV=1 docker run --rm -e VISUAL_SET=full -e UPDATE="${UPDATE:-changed}" -e GREP="${GREP:-}" -v "$ROOT:/src" -w /work "$IMAGE" bash -euo pipefail -c '
  tar -C /src \
    --exclude=node_modules --exclude=dist --exclude=test-results --exclude=playwright-report \
    --exclude=./.git --exclude=./data \
    -cf - . | tar -xf -
  npm install -g pnpm@10.33.1 >/dev/null
  pnpm install --frozen-lockfile
  pnpm --filter @meshterm/server build
  pnpm --filter @meshterm/web build
  cd apps/web
  pnpm exec playwright test -c e2e/playwright.config.ts \
    --project "visual-*" --update-snapshots="${UPDATE:-changed}" \
    ${GREP:+-g "$GREP"}
  cp e2e/visual.spec.ts-snapshots/*-linux.png /src/apps/web/e2e/visual.spec.ts-snapshots/
  ls -1 /src/apps/web/e2e/visual.spec.ts-snapshots/
'
