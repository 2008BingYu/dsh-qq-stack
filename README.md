# dsh-qq-stack

给 DeepSeek Harness 装上 QQ：LinuxQQ + NapCat 随引擎启动，扫码一次之后自动登录。

## 安装

```bash
dsh plugin --profile web add dsh-qq-stack
```

或者把打好的 tgz 包拖进 DSH 的「插件 › 添加插件」。装完重启一次引擎。

## 首次安装会做什么

插件在引擎启动约 8 秒后检查运行环境，缺了就在后台自动装：

1. 下载 **LinuxQQ**（约 198MB，腾讯 CDN）
2. 下载 **NapCat**（约 34MB）—— 会先测 6 个源的下载速度，挑最快的；全部失败时自动换镜像
3. 解包、检查缺失的动态库（`ldd`，不猜包名，缺了才 `apt install`）
4. 打补丁、写 OneBot 配置、生成启动脚本
5. 启动 QQ

`设置 › QQ 底座` 里会显示进度条：`测速中` → `LinuxQQ 45%` → `NapCat 30%` → 完成。安装日志在 `~/.dsh/qq-bot/logs/install.log`。

装好之后不再下载；之后每次启动只做“拉起 QQ”。

## 使用

打开 `设置 › QQ 底座`：

- **未登录**：页面里直接显示二维码（不会存到手机相册）。用手机 QQ 扫码，再在手机上点「允许登录」
- **已登录**：显示头像、昵称、QQ 号；点「切换账号」可以换号
- 上方三行状态：QQ 进程、OneBot 端口、登录状态，绿点是正常

登录成功后，下次打开 DSH 会用这个号自动快登，不用再扫码。

## 配置

`~/.dsh/qq-bot/config.env`：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `DSH_QQ_UIN` | 登录后自动写入 | 自动快登的 QQ 号 |
| `DSH_QQ_WS_PORT` | `3001` | OneBot 正向 WebSocket 端口 |
| `DSH_QQ_TOKEN` | `dshfish-3001` | WebSocket 令牌，接入 OneBot 的客户端用来认证 |

安装目录默认 `~/.dsh/qq-bot`，可用环境变量 `DSH_QQ_ROOT` 修改。

## 要求

- Linux（aarch64 / amd64），能装 apt 包；Android 上的 DSH 运行环境也可以
- Node ≥ 22.5
- 首次安装约 250MB 磁盘和下载

## 常见问题

**扫码后一直显示未登录？**
在手机上点「允许登录」才算完成，只扫码不确认不算。确认后十几秒内会变成已登录。

**卸载重装后要重新扫码？**
会。卸载会清掉登录数据，重装等于全新安装，需要再扫一次。

**过一段时间掉线？**
插件在引擎启动时会把 QQ 拉起来，并按保存的账号自动快登。进程被系统杀掉后，重新打开 DSH 即可恢复；登录态失效时需重新扫码。

**群里不回复？**
这是负责聊天的插件自己的设置，本插件只负责让 QQ 保持在线。

**支持 Windows 吗？**
不支持。安装的是 Linux 版 QQ 客户端，启动依赖 `xvfb-run` 和 `dbus-run-session`。

## 卸载

卸载插件后，后台清理器会在 20 秒内停掉 QQ、删掉 `~/.dsh/qq-bot`（含 700MB 以上的客户端和登录数据）。

想立刻清也可以：

```bash
bash ~/.dsh/qq-bot/stop-qq.sh && rm -rf ~/.dsh/qq-bot
```

## 许可

MIT
