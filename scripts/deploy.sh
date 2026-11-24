#!/usr/bin/env bash
# Safe deploy for survey.jaipurrugs.org (see docs/deploy.md).
#
# Builds each release in its own folder, so a failed install or build never
# touches the running site. Only after a successful build does ~/jrf/current
# switch to the new release and PM2 restart; if the new release doesn't answer
# within a minute, it switches back to the previous one automatically.
#
#   ~/jrf/releases/<time>-<sha>/   one git worktree per release (last 3 kept)
#   ~/jrf/current                  symlink to the live release (PM2's cwd)
#   ~/jrf/shared/.env.local        the app's secrets, linked into every release
#
# Usage (on the server):  ~/jrf/current/scripts/deploy.sh [branch]   (default: main)

set -Eeuo pipefail

APP_NAME="jaipurrugs-foundation"
PORT=3002
BASE="${JRF_BASE:-$HOME/jrf}"
REPO="${JRF_REPO:-$HOME/jaipurrugs-foundation-custom-webapp}"
BRANCH="${1:-main}"
KEEP=3
HEALTH_URL="http://127.0.0.1:${PORT}/auth/login"

log() { printf '[deploy %s] %s\n' "$(date +%H:%M:%S)" "$*"; }

mkdir -p "$BASE/releases" "$BASE/logs"
[[ -f "$BASE/shared/.env.local" ]] || { log "Missing $BASE/shared/.env.local"; exit 1; }

# One deploy at a time.
exec 9>"$BASE/deploy.lock"
flock -n 9 || { log "Another deploy is already running."; exit 1; }

git -C "$REPO" fetch --quiet origin "$BRANCH"
SHA="$(git -C "$REPO" rev-parse --short "origin/$BRANCH")"
NAME="$(date +%Y%m%d-%H%M%S)-$SHA"
REL="$BASE/releases/$NAME"
LOG="$BASE/logs/$NAME.log"

discard_release() {
  git -C "$REPO" worktree remove --force "$REL" 2>/dev/null || rm -rf "$REL"
  git -C "$REPO" worktree prune
}

fail_before_switch() {
  log "FAILED: $1. The live site was not touched. Details: $LOG"
  tail -n 25 "$LOG" || true
  discard_release
  exit 1
}

healthy() {
  for _ in $(seq 1 30); do
    curl -fsS -o /dev/null --max-time 5 "$HEALTH_URL" && return 0
    sleep 2
  done
  return 1
}

log "Preparing $NAME (origin/$BRANCH)"
git -C "$REPO" worktree add --detach --quiet "$REL" "origin/$BRANCH"
ln -s "$BASE/shared/.env.local" "$REL/.env.local"
cd "$REL"

log "Installing packages"
npm ci --include=dev --no-audit --no-fund >"$LOG" 2>&1 || fail_before_switch "npm ci"

log "Building"
npm run build >>"$LOG" 2>&1 || fail_before_switch "build"
[[ -f "$REL/.next/BUILD_ID" ]] || fail_before_switch "build produced no .next/BUILD_ID"

PREV="$(readlink -f "$BASE/current" 2>/dev/null || true)"

switch_to() {
  ln -sfn "$1" "$BASE/current.tmp"
  mv -T "$BASE/current.tmp" "$BASE/current"
  pm2 restart "$APP_NAME" >/dev/null
}

log "Switching live site to $NAME"
switch_to "$REL"

if healthy; then
  log "Live and healthy: $NAME"
else
  if [[ -n "$PREV" && -d "$PREV" ]]; then
    log "FAILED: new release did not answer on $HEALTH_URL. Rolling back to $(basename "$PREV")."
    switch_to "$PREV"
    healthy && log "Rolled back; previous release is live." || log "WARNING: previous release is not answering either. Check: pm2 logs $APP_NAME"
    discard_release
  else
    # Nothing to go back to, so leave this release live for debugging.
    log "FAILED: new release did not answer and there is no previous release to roll back to."
  fi
  pm2 logs "$APP_NAME" --nostream --lines 30 --err 2>/dev/null || true
  exit 1
fi

pm2 save --force >/dev/null

# Keep the newest $KEEP releases (the live one is always the newest after a success).
mapfile -t old < <(ls -1d "$BASE"/releases/*/ 2>/dev/null | sort | head -n "-$KEEP")
for dir in "${old[@]}"; do
  dir="${dir%/}"
  [[ "$dir" == "$(readlink -f "$BASE/current")" ]] && continue
  git -C "$REPO" worktree remove --force "$dir" 2>/dev/null || rm -rf "$dir"
done
git -C "$REPO" worktree prune
ls -1t "$BASE"/logs/*.log 2>/dev/null | tail -n +11 | xargs -r rm -f

log "Done."
