#!/usr/bin/env bash
#
# Cross-implementation parity gate: prove the Node (js/) and Swift (macos/)
# format layers produce byte-identical dumps. Two dumpers, one diff.
#
# Usage: scripts/parity/check.sh
#
# Exit codes:
#   0  Node and Swift dumps are byte-identical
#   1  the dumps differ (the diff is printed)
#   2  the Swift dumper is not built yet (graceful; nothing to compare)
#
# The Swift package location defaults to macos/ConstellationKit/ and can be
# overridden with CONSTELLATION_SWIFT_DIR (useful for CI or a relocated package).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
SWIFT_DIR="${CONSTELLATION_SWIFT_DIR:-$REPO_ROOT/macos/ConstellationKit}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
NODE_OUT="$WORK/node"
SWIFT_OUT="$WORK/swift"
mkdir -p "$NODE_OUT" "$SWIFT_OUT"

# ── Node half ───────────────────────────────────────────────────────
node "$REPO_ROOT/scripts/parity/dump-node.mjs" "$NODE_OUT"

# ── Swift half (may not exist yet) ──────────────────────────────────
if ! command -v swift >/dev/null 2>&1; then
  echo "swift dumper not built yet: 'swift' not found on PATH" >&2
  exit 2
fi
if [ ! -e "$SWIFT_DIR/Package.swift" ]; then
  echo "swift dumper not built yet: no Swift package at $SWIFT_DIR (set CONSTELLATION_SWIFT_DIR)" >&2
  exit 2
fi
if ! swift run --package-path "$SWIFT_DIR" constellation-dump "$SWIFT_OUT"; then
  echo "swift dumper not built yet: 'swift run constellation-dump' failed to build/run" >&2
  exit 2
fi

# ── Compare ─────────────────────────────────────────────────────────
if diff -ru "$NODE_OUT" "$SWIFT_OUT"; then
  echo "parity OK: Node and Swift dumps are byte-identical"
  exit 0
else
  echo "parity FAILED: Node and Swift dumps differ (see diff above)" >&2
  exit 1
fi
