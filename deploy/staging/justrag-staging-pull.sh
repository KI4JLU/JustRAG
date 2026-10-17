#!/usr/bin/env bash
# Keeps the staging server on the `:staging` image. Run by
# justrag-staging-pull.timer every few minutes; see README.md here.
#
# `:staging` only moves when someone runs the "Deploy to Staging" workflow, so
# almost every run pulls nothing and exits. When the digest did change, the
# stack is brought up again: the `migrate` one-shot applies new migrations
# first, then compose recreates exactly the containers whose image changed.
#
# Env (set in the systemd unit):
#   JUSTRAG_DIR    checkout holding the compose files and .env (default /opt/justrag)
#   COMPOSE_FILE   read by docker compose itself, e.g.
#                  docker-compose.yml:docker-compose.production.yml
#   JUSTRAG_IMAGE  default ghcr.io/ki4jlu/justrag:staging
set -euo pipefail

cd "${JUSTRAG_DIR:-/opt/justrag}"
image="${JUSTRAG_IMAGE:-ghcr.io/ki4jlu/justrag:staging}"

# A slow pull must not overlap the next timer run.
exec 9>/run/lock/justrag-staging-pull.lock
flock -n 9 || { echo "previous run still active, skipping"; exit 0; }

digest() { docker image inspect --format '{{index .RepoDigests 0}}' "$image" 2>/dev/null || true; }

before=$(digest)
docker compose pull --quiet
after=$(digest)

if [[ -n "$before" && "$before" == "$after" ]]; then
  exit 0
fi

echo "staging image changed: ${before:-none} -> $after"
docker compose up -d --remove-orphans
# The previous :staging image is now dangling; without this the disk fills
# up one image per deploy.
docker image prune -f >/dev/null
echo "staging is up on $after"
