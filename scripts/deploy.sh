#!/usr/bin/env bash
# Deploy Cap Baseball to Raspberry Pi:
#   scripts/deploy.sh          Test, build, upload, drain active matches and restart
#   scripts/deploy.sh --now    Immediate restart without waiting for active matches
#   scripts/deploy.sh rollback Roll back to previous known-good release
#   scripts/deploy.sh url      Print current Cloudflare quick tunnel URL
set -euo pipefail
HOST=${DEPLOY_HOST:-chang@pi.local}
MODE=${1:-}
cd "$(dirname "$0")/.."

if [[ $MODE == url ]]; then
  ssh "$HOST" "journalctl --user-unit capbaseball-quick --no-pager | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1"
  exit
fi

if [[ $MODE == rollback ]]; then
  ssh "$HOST" 'bash -s' <<'R'
set -euo pipefail
cd ~/capbaseball
cur=$(basename "$(readlink current)")
prev=$(for r in $(ls -1 releases | sort); do if [[ $r < $cur && -e releases/$r/.ok ]]; then echo "$r"; fi; done | tail -1)
[[ -n $prev ]] || { echo "沒有更舊的版本可以回滾"; exit 1; }
ln -sfn "releases/$prev" current
echo "等進行中的對局打完再換版（最多 5 分鐘）…"
systemctl --user reset-failed capbaseball 2>/dev/null || true
systemctl --user restart capbaseball
sleep 2
curl -fsS localhost:8788/health && echo && echo "已從 $cur 回滾到 $prev"
R
  exit
fi

npm test
npm run build
BUILD=$(node -p 'require("./dist/version.json").build')
DIR=capbaseball/releases/$BUILD
ssh "$HOST" "mkdir -p $DIR capbaseball/data"
rsync -a --delete dist dist-server deploy package.json package-lock.json "$HOST:$DIR/"

ssh "$HOST" 'bash -s' -- "$BUILD" "$MODE" <<'R'
set -euo pipefail
B=$1 MODE=${2:-}
export PATH=$HOME/node/bin:$PATH
cd ~/capbaseball
prev=$(readlink current || true)
if [[ -n $prev && -d $prev/node_modules ]] && cmp -s "$prev/package-lock.json" "releases/$B/package-lock.json"; then
  cp -al "$prev/node_modules" "releases/$B/"
else
  (cd "releases/$B" && npm ci --omit=dev --no-audit --no-fund)
fi
mkdir -p ~/.config/systemd/user
cp "releases/$B/deploy/"*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable capbaseball 2>/dev/null || true
if systemctl --user is-enabled -q capbaseball-tunnel 2>/dev/null; then
  systemctl --user start capbaseball-tunnel 2>/dev/null || true
elif [[ -x "$HOME/cloudflared/cloudflared" ]]; then
  systemctl --user enable --now capbaseball-quick 2>/dev/null || true
fi
ln -sfn "releases/$B" current

if [[ $MODE == --now ]] && systemctl --user is-active -q capbaseball; then
  systemctl --user kill -s SIGINT capbaseball
else
  echo "提前 60 秒預告更新並等進行中的對局打完再換版（最多 6 分鐘）…"
  systemctl --user reset-failed capbaseball 2>/dev/null || true
  systemctl --user restart capbaseball
fi

v=""
for _ in $(seq 30); do
  v=$(curl -fsS localhost:8788/health 2>/dev/null | grep -o "\"version\":\"$B\"" || true)
  [[ -n $v ]] && break
  sleep 1
done
if [[ -z $v ]]; then
  echo "新版 $B 沒有正常啟動，自動回滾"
  journalctl --user-unit capbaseball -n 30 --no-pager || true
  rm -rf "releases/$B"
  if [[ -n $prev ]]; then
    ln -sfn "$prev" current
    systemctl --user reset-failed capbaseball 2>/dev/null || true
    systemctl --user restart capbaseball
  fi
  exit 1
fi

touch "releases/$B/.ok"
for old in $(ls -1 releases | sort | head -n -5); do
  if [[ releases/$old != "$(readlink current)" ]]; then rm -rf "releases/$old"; fi
done
echo "上線版本 $B"
R
