#!/bin/bash
set -u
ROOT="${DSH_QQ_ROOT:-/root/qq-bot}"
mkdir -p "$ROOT"/{logs,opt,data/qq-home/.config,data/qq-home/.local/share,data/qq-home/.cache,data/runtime}
cd "$ROOT" || exit 1

if [ -f "$ROOT/config.env" ]; then
  set -a; . "$ROOT/config.env"; set +a
fi
UIN=""
WS_PORT="${DSH_QQ_WS_PORT:-3001}"
HOST="${DSH_QQ_HOST:-127.0.0.1}"
TOKEN="${DSH_QQ_TOKEN:-}"

if [ ! -f "$ROOT/config.env" ]; then
  cat > "$ROOT/config.env" <<EOF
DSH_QQ_UIN=$UIN
DSH_QQ_WS_PORT=$WS_PORT
DSH_QQ_HOST=$HOST
DSH_QQ_TOKEN=$TOKEN
EOF
fi

speed_of() {
  curl -sL -r 0-262144 -o /dev/null --connect-timeout 6 --max-time 8 -w '%{speed_download}' "$1" 2>/dev/null || echo 0
}

pick_mirror() {
  local best="" bestv=0 u v
  echo "[progress] 测速中" >&2
  local i=0 total=0
  total=$(echo "$NAPCAT_MIRRORS" | grep -c .)
  for u in $NAPCAT_MIRRORS; do
    i=$((i+1))
    echo "[progress] 测速 $i/$total" >&2
    v=$(speed_of "$u")
    case "$v" in ''|*[!0-9.]*) v=0 ;; esac
    if awk -v a="$v" -v b="$bestv" 'BEGIN{exit !(a>b)}'; then best="$u"; bestv="$v"; fi
  done
  echo "[progress] 选源 $(( ${bestv%.*} / 1024 ))KB/s" >&2
  echo "$best"
}

dl() {
  local url="$1" out="$2" label="$3" expect="${4:-0}" total cur pid
  echo "[progress] $label 0%"
  total=$(curl -sIL --connect-timeout 8 --max-time 15 "$url" 2>/dev/null | awk 'tolower($1)=="content-length:"{print $2}' | tail -1)
  curl -fL --retry 3 --connect-timeout 15 -o "$out" "$url" >/dev/null 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    cur=$(stat -c %s "$out" 2>/dev/null || echo 0)
    if [ -n "${total:-}" ] && [ "$total" -gt 0 ] 2>/dev/null; then
      echo "[progress] $label $(( cur * 100 / total ))% ($(( cur / 1048576 ))/$(( total / 1048576 ))MB)"
    else
      if [ "$expect" -gt 0 ] 2>/dev/null; then
        echo "[progress] $label $(( cur * 100 / (expect * 1048576) ))% ($(( cur / 1048576 ))/${expect}MB)"
      else
        echo "[progress] $label $(( cur / 1048576 ))MB"
      fi
    fi
    sleep 2
  done
  wait "$pid" || return 1
  echo "[progress] $label 100%"
  return 0
}

say() { echo "[install $(date +%H:%M:%S)] $*"; }

ARCH="$(dpkg --print-architecture 2>/dev/null || uname -m)"
case "$ARCH" in
  arm64|aarch64) QQ_ARCH=arm64 ;;
  amd64|x86_64)  QQ_ARCH=amd64 ;;
  *) say "不支持的架构：$ARCH"; exit 1 ;;
esac
QQ_VER="3.2.34-53644"
QQ_DEB_URL="https://qqdl.gtimg.cn/qqfile/QQNT/9.9.36/beta/9ee04bef/linuxqq_${QQ_VER}_${QQ_ARCH}.deb"
NAPCAT_ZIP="https://github.com/NapNeko/NapCatQQ/releases/latest/download/NapCat.Shell.zip"
NAPCAT_MIRRORS="
https://github.com/NapNeko/NapCatQQ/releases/latest/download/NapCat.Shell.zip
https://gh-proxy.com/$NAPCAT_ZIP
https://ghfast.top/$NAPCAT_ZIP
https://ghproxy.net/$NAPCAT_ZIP
https://gh-proxy.org/$NAPCAT_ZIP
https://hub.gitmirror.com/$NAPCAT_ZIP
"

if [ ! -x "$ROOT/opt/opt/QQ/qq" ]; then
  echo "[step] linuxqq"
  say "下载 LinuxQQ ${QQ_ARCH}（约 200MB）"
  dl "$QQ_DEB_URL" /tmp/QQ.deb "LinuxQQ" 198 || { say "LinuxQQ 下载失败"; exit 1; }
  dpkg -x /tmp/QQ.deb "$ROOT/opt" || { say "解包失败"; exit 1; }
  rm -f /tmp/QQ.deb
else
  say "LinuxQQ 已存在，跳过"
fi

QQ_APP="$ROOT/opt/opt/QQ/resources/app"

ensure_deps() {
  need=0
  command -v xvfb-run >/dev/null 2>&1 || need=1
  command -v dbus-run-session >/dev/null 2>&1 || need=1
  if [ -x "$ROOT/opt/opt/QQ/qq" ] && ldd "$ROOT/opt/opt/QQ/qq" 2>/dev/null | grep -q "not found"; then
    need=1
  fi
  [ "$need" = 0 ] && return 0
  say "补齐运行依赖"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq || true
  pkgs=""
  for p in xvfb dbus-x11 libnss3 libgbm1 libasound2t64 libasound2 libgtk-3-0t64 libgtk-3-0 \
           libxss1 libxtst6 libdrm2 libxkbcommon0 libcups2 libpango-1.0-0 libcairo2 \
           libatk1.0-0 libatk-bridge2.0-0 libxdamage1 libxrandr2 libatspi2.0-0 libnspr4 \
           libxcomposite1 libxfixes3 libxrender1; do
    apt-cache show "$p" >/dev/null 2>&1 && pkgs="$pkgs $p"
  done
  apt-get install -y $pkgs || { say "依赖安装失败"; exit 1; }
}

ensure_deps

if [ ! -f "$QQ_APP/app_launcher/napcat/napcat.mjs" ]; then
  echo "[step] napcat"
  say "下载 NapCat"
  if [ -f /tmp/NapCat.Shell.zip ] && unzip -t /tmp/NapCat.Shell.zip >/dev/null 2>&1; then
    say "复用已下载的 NapCat 包"
  else
  MIRROR=$(pick_mirror)
  if [ -n "$MIRROR" ]; then
    say "使用镜像：$MIRROR"
    dl "$MIRROR" /tmp/NapCat.Shell.zip "NapCat" 35 || { say "NapCat 下载失败"; exit 1; }
  else
    say "所有源都不可用"
    exit 1
  fi
  fi
  rm -rf /tmp/napcat-unzip && mkdir -p /tmp/napcat-unzip
  unzip -q -o /tmp/NapCat.Shell.zip -d /tmp/napcat-unzip || { say "NapCat 解压失败"; exit 1; }
  mkdir -p "$QQ_APP/app_launcher"
  cp -a /tmp/napcat-unzip "$QQ_APP/app_launcher/napcat"
  rm -rf /tmp/napcat-unzip /tmp/NapCat.Shell.zip
else
  say "NapCat 已存在，跳过"
fi

echo "[step] patch"
cat > "$QQ_APP/loadNapCat.js" <<'EOF'
const path = require('node:path');
const { pathToFileURL } = require('node:url');
import(pathToFileURL(path.join(__dirname, 'app_launcher/napcat/napcat.mjs')).href);
EOF
node -e '
const fs=require("fs");const p=process.argv[1];
const j=JSON.parse(fs.readFileSync(p,"utf8"));
if(j.main!=="./loadNapCat.js"){j.main="./loadNapCat.js";fs.writeFileSync(p,JSON.stringify(j,null,2));}
' "$QQ_APP/package.json" || { say "补丁失败"; exit 1; }

CFG_DIR="$QQ_APP/app_launcher/napcat/config"
mkdir -p "$CFG_DIR"
write_onebot() {
  local uin="$1"
  cat > "$CFG_DIR/onebot11_${uin}.json" <<EOF
{
  "network": {
    "httpServers": [],
    "httpSseServers": [],
    "httpClients": [],
    "websocketServers": [
      {
        "name": "dsh",
        "enable": true,
        "host": "${HOST:-127.0.0.1}",
        "port": $WS_PORT,
        "messagePostFormat": "array",
        "reportSelfMessage": false,
        "token": "${TOKEN:-}",
        "debug": false,
        "heartInterval": 30000,
        "enableForcePushEvent": true
      }
    ],
    "websocketClients": [],
    "plugins": []
  },
  "musicSignUrl": "",
  "enableLocalFile2Url": false,
  "parseMultMsg": false,
  "imageDownloadProxy": ""
}
EOF
}

if ! ls "$CFG_DIR"/onebot11_*.json >/dev/null 2>&1; then
  say "写入 OneBot 配置（ws ${WS_PORT}）"
  write_onebot "${UIN:-default}"
fi

cat > "$ROOT/fix-onebot.mjs" <<'EOFJS'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] || '/root/qq-bot'
const port = Number(process.env.DSH_QQ_WS_PORT || 3001)
const host = process.env.DSH_QQ_HOST || '127.0.0.1'
const token = process.env.DSH_QQ_TOKEN || ''
const dir = join(root, 'opt/opt/QQ/resources/app/app_launcher/napcat/config')
let files = []
try { files = readdirSync(dir) } catch { process.exit(0) }
for (const f of files) {
  if (!/^onebot11_\d{5,12}\.json$/.test(f)) continue
  const p = join(dir, f)
  let d = {}
  try { d = JSON.parse(readFileSync(p, 'utf8')) } catch { continue }
  d.network = d.network || {}
  const ws = Array.isArray(d.network.websocketServers) ? d.network.websocketServers : []
  const hit = ws.find((x) => Number(x.port) === port && x.enable !== false)
  if (hit) {
    if (String(hit.token || '') !== String(token || '')) { if (token) hit.token = token; else delete hit.token; try { writeFileSync(p, JSON.stringify(d, null, 2)) } catch {} }
    continue
  }
  const entry = { name: 'dsh', enable: true, host, port, messagePostFormat: 'array', reportSelfMessage: false, debug: false, heartInterval: 30000, enableForcePushEvent: true }
  if (token) entry.token = token
  d.network.websocketServers = [entry]
  try { writeFileSync(p, JSON.stringify(d, null, 2)) } catch {}
}
EOFJS

if [ ! -f "$ROOT/start-qq.sh" ]; then
cat > "$ROOT/start-qq.sh" <<EOF
#!/bin/bash
cd "\$(dirname "\$0")" || exit 1
[ -f config.env ] && { set -a; . ./config.env; set +a; }
mkdir -p logs data/qq-home/.config data/qq-home/.local/share data/qq-home/.cache data/runtime
chmod 700 data/runtime
export HOME="$ROOT/data/qq-home"
export XDG_CONFIG_HOME="\$HOME/.config" XDG_DATA_HOME="\$HOME/.local/share" XDG_CACHE_HOME="\$HOME/.cache"
export XDG_RUNTIME_DIR="$ROOT/data/runtime"
export ELECTRON_DISABLE_SANDBOX=1
[ -n "\${DSH_QQ_UIN:-}" ] && export NAPCAT_QUICK_ACCOUNT="\$DSH_QQ_UIN"
if command -v node >/dev/null 2>&1 && [ -f fix-onebot.mjs ]; then node fix-onebot.mjs "$(pwd)" 2>/dev/null || true; fi
if [ -f qq.pid ] && kill -0 "\$(cat qq.pid)" 2>/dev/null; then echo "QQ 已在运行"; exit 0; fi
if [ -f ../../logs/qq.log ] && [ "$(stat -c %s ../../logs/qq.log 2>/dev/null || echo 0)" -gt 5242880 ]; then mv -f ../../logs/qq.log ../../logs/qq.log.1; fi
cd opt/opt/QQ
setsid dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" ./qq \\
  --no-sandbox --disable-gpu --disable-gpu-sandbox --in-process-gpu \\
  --disable-dev-shm-usage --disable-gpu-compositing >> ../../../logs/qq.log 2>&1 &
echo \$! > ../../../qq.pid
echo "QQ 启动中 (pid \$!)"
EOF
fi

if [ ! -f "$ROOT/stop-qq.sh" ]; then
cat > "$ROOT/stop-qq.sh" <<'EOF'
#!/bin/bash
cd "$(dirname "$0")" || exit 1
pid=$(cat qq.pid 2>/dev/null)
if [ -n "$pid" ]; then
  pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
  [ -n "$pgid" ] && kill -TERM -"$pgid" 2>/dev/null
  for i in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  [ -n "$pgid" ] && kill -KILL -"$pgid" 2>/dev/null
  kill -KILL "$pid" 2>/dev/null
fi
for p in $(ps -eo pid=,comm= 2>/dev/null | awk '$2=="qq"||$2=="Xvfb"{print $1}'); do
  kill -KILL "$p" 2>/dev/null
done
rm -f qq.pid
EOF
fi

chmod +x "$ROOT"/*.sh
if [ -n "${UIN:-}" ]; then write_onebot "$UIN"; fi
touch "$ROOT/.installed"
echo "[step] start"
say "安装完成，启动 QQ"
bash "$ROOT/start-qq.sh"
