#!/usr/bin/env bash
# Prints the next release version: vYY.M.N (CalVer, docs/runbooks/release.md).
#
#   YY.M  the current year and month in Europe/Berlin, month NOT zero-padded
#         (npm and strict semver reject a leading zero: 26.1.0, never 26.01.0)
#   N     0 for the month's first release, else 1 + the highest released N
#
# Only promoted releases count (`vYY.M.N` tags), not release candidates: an
# abandoned `v26.11.2-rc.1` leaves 26.11.2 free, and the next candidate for
# it continues as -rc.2 (cut-release.yml numbers RCs).
#
# Usage: scripts/next-version.sh            # e.g. v26.11.0
#        git fetch --tags first, or the count is only as fresh as your clone.
set -euo pipefail

month=$(TZ=Europe/Berlin date +%y.%-m)
last=$(git tag -l "v$month.*" | grep -E "^v${month//./\\.}\.[0-9]+$" | sed "s/^v$month\.//" | sort -n | tail -1 || true)
if [[ -z "$last" ]]; then
  echo "v$month.0"
else
  echo "v$month.$((last + 1))"
fi
