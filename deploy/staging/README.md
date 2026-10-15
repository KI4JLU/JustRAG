# Staging auto-pull

The staging server runs whatever the `:staging` image tag points at. The tag
is moved in GitHub (Actions → **Deploy to Staging**). This timer makes the
server follow it, so nothing has to be done on the server for a deploy.

The server pulls (instead of GitHub pushing to it) because it sits inside the
university network: GitHub cannot reach it, and no SSH key or deploy secret
has to live in GitHub.

## Setup (once)

Assumes the checkout lives at `/opt/justrag`. If it doesn't, change
`JUSTRAG_DIR` and `ExecStart` in the `.service` file.

```bash
# 1. The image tag staging follows
echo 'JUSTRAG_VERSION=staging' >> /opt/justrag/.env

# 2. Registry login for root (the timer runs as root); the package is private.
#    Password: a GitHub PAT with read:packages.
sudo docker login ghcr.io

# 3. Install and start the timer
sudo cp /opt/justrag/deploy/staging/justrag-staging-pull.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now justrag-staging-pull.timer
```

If staging uses compose files other than `docker-compose.yml` +
`docker-compose.production.yml`, adjust `COMPOSE_FILE` in the `.service`
file (colon-separated, read by `docker compose` itself).

## Day to day

```bash
systemctl list-timers justrag-staging-pull.timer   # next / last run
journalctl -u justrag-staging-pull -n 50           # what the last runs did
sudo systemctl start justrag-staging-pull          # pull right now
curl -s https://<staging-host>/version             # what is actually running
```

A run that finds no new digest exits silently. A run that finds one logs
`staging image changed: … -> …`, runs `docker compose up -d` (the `migrate`
one-shot first, then the containers whose image changed) and removes the old
image.

## What it does not do

- **It does not update the compose files.** Only the image follows
  `:staging`; the checkout in `/opt/justrag` stays where it is. When a change
  touches `docker-compose*.yml` or `.env.example`, update the checkout by hand
  (`git pull`) to the branch you are testing.
- **It cannot undo migrations.** Every image staging pulls runs its
  migrations, and `cmd/migrate` is up-only. Deploying an older image after a
  newer one with a migration means old code on a newer schema. To really go
  back, restore the staging database from a snapshot. See
  `docs/runbooks/release.md` → "Staging".
