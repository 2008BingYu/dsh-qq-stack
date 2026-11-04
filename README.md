# dsh-qq-stack

给 DeepSeek Harness 装上 QQ：LinuxQQ + NapCat 跟着引擎一起启动，扫码一次，之后自动登录。

## 安装

```bash
dsh plugin --profile web add dsh-qq-stack
```

或者把打好的 tgz 包拖进 DSH 的「插件 › 添加插件」。

装完重启一次引擎，第一次运行会自动下载 LinuxQQ 和 NapCat（约 250MB），之后就不再下载。

## 使用

打开 `设置 › QQ 底座`：

- **未登录**：显示二维码，用手机 QQ 扫码并在手机上点「允许登录」
- **已登录**：显示头像、昵称、QQ 号；点「切换账号」可以换号
- 上方三行是状态：QQ 进程、OneBot 端口、登录状态，绿点是正常

登录成功后，下次打开 DSH 会自动快登这个号，不用再扫码。

## 配置

`~/.dsh/qq-bot/config.env`：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `DSH_QQ_UIN` | 登录后自动写入 | 自动快登的 QQ 号 |
| `DSH_QQ_WS_PORT` | `3001` | OneBot 正向 WebSocket 端口 |
| `DSH_QQ_TOKEN` | `dshfish-3001` | WebSocket 令牌，接入 OneBot 的客户端用来认证 |

安装目录默认 `~/.dsh/qq-bot`，可用环境变量 `DSH_QQ_ROOT` 修改。

## 要求

- Linux（aarch64 / amd64），能装 apt 包；Android 的 DSH 运行环境也可以
- Node ≥ 22.5
- 首次安装约 250MB 磁盘和下载

## 常见问题

**扫码后一直显示未登录？**
在手机上确认「允许登录」，只扫码不确认不算登录。确认后十几秒内状态会变成已登录。

**过一段时间掉线？**
打不开 DSH、或者引擎重启时，插件会把 QQ 拉起来，并按保存的账号自动快登。如果 QQ 进程被系统杀掉，重新打开 DSH 即可恢复；登录态失效时，需要重新扫码一次。

**群里不回复？**
这是负责聊天的插件自己的设置，本插件只负责让 QQ 保持在线。

## 许可

MIT
