#!/usr/bin/env bash
# Release deploy, run on the server by the GitHub Actions workflow.
#
# The workflow's SSH key is pinned to this script in ~/.ssh/authorized_keys
# (command="…/deploy-from-ci.sh",restrict), so that key can do nothing else.
#   SSH_ORIGINAL_COMMAND = "release <version> <build-number>"
#   stdin                = the signed APK
#
# Steps: store the APK + app-version.json in apps/web/public, pull the
# released code, rebuild (Vite copies public/ into the served dist/), and
# restart the pm2 process.
set -euo pipefail

APP_DIR="${INFRAME_DIR:-/opt/var/inframe}"
PM2_NAME="${INFRAME_PM2_NAME:-inframe}"
PUBLIC="$APP_DIR/apps/web/public"

read -r action version build extra <<<"${SSH_ORIGINAL_COMMAND:-}" || true
if [[ "${action:-}" != "release" || -n "${extra:-}" ]]; then
  echo "usage: release <version> <build>" >&2
  exit 2
fi
[[ "$version" =~ ^[0-9A-Za-z.+-]{1,40}$ ]] || { echo "bad version" >&2; exit 2; }
[[ "$build" =~ ^[0-9]{1,9}$ ]] || { echo "bad build number" >&2; exit 2; }

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

mkdir -p "$PUBLIC"
tmp="$(mktemp "$PUBLIC/.inframe-apk.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

cat >"$tmp"
size="$(stat -c %s "$tmp")"
if (( size < 1000000 )); then
  echo "APK is only $size bytes — refusing to publish it" >&2
  exit 3
fi
if [[ "$(head -c 2 "$tmp")" != "PK" ]]; then
  echo "upload is not an APK (zip) file" >&2
  exit 3
fi

cd "$APP_DIR"
echo "==> pulling the released code"
git fetch --tags --quiet origin
git pull --ff-only --quiet origin main

echo "==> publishing APK $version ($build), $size bytes"
chmod 644 "$tmp"
mv "$tmp" "$PUBLIC/inframe.apk"
trap - EXIT
printf '{"version":"%s","build":%s,"size":%s,"url":"/inframe.apk","publishedAt":"%s"}\n' \
  "$version" "$build" "$size" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$PUBLIC/app-version.json"

echo "==> installing and building"
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent

echo "==> restarting $PM2_NAME"
pm2 restart "$PM2_NAME" --update-env >/dev/null
pm2 save >/dev/null
echo "deployed InFrame $version (build $build)"
