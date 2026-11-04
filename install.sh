#!/bin/bash
set -u
ROOT="${DSH_QQ_ROOT:-/root/qq-bot}"
mkdir -p "$ROOT"/{logs,opt,data/qq-home/.config,data/qq-home/.local/share,data/qq-home/.cache,data/runtime}
cd "$ROOT" || exit 1

if [ -f "$ROOT/config.env" ]; then
  set -a; . "$ROOT/config.env"; set +a
fi
UIN="${DSH_QQ_UIN:-}"
WS_PORT="${DSH_QQ_WS_PORT:-3001}"
TOKEN="${DSH_QQ_TOKEN:-dshfish-3001}"

if [ ! -f "$ROOT/config.env" ]; then
  cat > "$ROOT/config.env" <<EOF
DSH_QQ_UIN=$UIN
DSH_QQ_WS_PORT=$WS_PORT
DSH_QQ_TOKEN=$TOKEN
EOF
fi

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

missing=""
for p in xvfb libnss3 libgbm1 libasound2t64 libgtk-3-0 dbus-x11 unzip curl; do
  dpkg -s "$p" >/dev/null 2>&1 || missing="$missing $p"
done
if [ -n "$missing" ]; then
  say "安装依赖：$missing"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y $missing || { say "依赖安装失败"; exit 1; }
fi

if [ ! -x "$ROOT/opt/opt/QQ/qq" ]; then
  say "下载 LinuxQQ ${QQ_ARCH}（约 200MB）"
  curl -fL --retry 3 -o /tmp/QQ.deb "$QQ_DEB_URL" || { say "LinuxQQ 下载失败"; exit 1; }
  dpkg -x /tmp/QQ.deb "$ROOT/opt" || { say "解包失败"; exit 1; }
  rm -f /tmp/QQ.deb
else
  say "LinuxQQ 已存在，跳过"
fi

QQ_APP="$ROOT/opt/opt/QQ/resources/app"

if [ ! -f "$QQ_APP/app_launcher/napcat/napcat.mjs" ]; then
  say "下载 NapCat"
  if [ -f /tmp/NapCat.Shell.zip ] && unzip -t /tmp/NapCat.Shell.zip >/dev/null 2>&1; then
    say "复用已下载的 NapCat 包"
  else
  curl -fL --retry 2 -o /tmp/NapCat.Shell.zip "$NAPCAT_ZIP" \
    || curl -fL --retry 2 -o /tmp/NapCat.Shell.zip "https://gh-proxy.com/$NAPCAT_ZIP" \
    || { say "NapCat 下载失败"; exit 1; }
  fi
  rm -rf /tmp/napcat-unzip && mkdir -p /tmp/napcat-unzip
  unzip -q -o /tmp/NapCat.Shell.zip -d /tmp/napcat-unzip || { say "NapCat 解压失败"; exit 1; }
  mkdir -p "$QQ_APP/app_launcher"
  cp -a /tmp/napcat-unzip "$QQ_APP/app_launcher/napcat"
  rm -rf /tmp/napcat-unzip /tmp/NapCat.Shell.zip
else
  say "NapCat 已存在，跳过"
fi

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
if ! ls "$CFG_DIR"/onebot11_*.json >/dev/null 2>&1; then
  say "写入 OneBot 配置（ws ${WS_PORT}）"
  cat > "$CFG_DIR/onebot11_${UIN:-default}.json" <<EOF
{
  "network": {
    "httpServers": [],
    "httpSseServers": [],
    "httpClients": [],
    "websocketServers": [
      {
        "name": "dsh",
        "enable": true,
        "host": "127.0.0.1",
        "port": $WS_PORT,
        "messagePostFormat": "array",
        "reportSelfMessage": false,
        "token": "$TOKEN",
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
fi

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
if [ -f qq.pid ] && kill -0 "\$(cat qq.pid)" 2>/dev/null; then echo "QQ 已在运行"; exit 0; fi
cd opt/opt/QQ
setsid dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" ./qq \\
  --no-sandbox --disable-gpu --disable-gpu-sandbox --in-process-gpu \\
  --disable-dev-shm-usage --disable-gpu-compositing > ../../../logs/qq.log 2>&1 &
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
say "安装完成，启动 QQ"
bash "$ROOT/start-qq.sh"
say "完成（首次需要扫码，之后启动会走 ${UIN:-未设置账号} 的快速登录）"
