# 临时公网会议入口

`scripts/public-demo.mjs` 把生产构建与会议服务运行在本机 `127.0.0.1:5190`，通过 Cloudflare Quick Tunnel 提供临时 HTTPS 地址。页面、API 与 WebSocket 使用同一个公网域名，不暴露 Vite 开发服务。无需 Cloudflare 账号或付费资源。

## 启动

先确保安装 Node.js、依赖和 `cloudflared`，然后在可直连 Cloudflare 的网络上运行：

```bash
node scripts/public-demo.mjs
```

这条命令先构建再启动。需要保持终端进程运行。已有经过验证的 `dist/` 时可加 `--skip-build`。默认本机端口为 `5190`，可设置 `DEMO_PORT` 更改。

让进程在当前终端退出后继续运行：

```bash
mkdir -p output/public-demo
nohup node scripts/public-demo.mjs --skip-build > output/public-demo/runner.log 2>&1 &
```

公开地址显示在日志中，也保存在 `output/public-demo/state.json`。当前入口以 `state.json` 为准：历史日志可能残留已弃用轮次的旧地址，例如 `runner.log` 里上一轮 localhost.run 方案的 `lhr.life` 地址。该文件只记录公开地址、进程号和启动时间。`cloudflare.log` 用于排查隧道连接问题。

## 本机的代理网络

本机现有系统代理是 `127.0.0.1:7897`，直接连接 Cloudflare 会超时。`cloudflared` 的临时隧道初始化没有读取常规 HTTP 代理变量，因此本轮使用两个仅监听 loopback 的转发器：一个把隧道初始化请求通过已有代理转发，一个透传 Cloudflare TLS 连接。凭据只在进程内传递，不写入日志或文件；不修改系统网络配置。

先在一个终端保持运行：

```bash
DEMO_HTTP_PROXY=http://127.0.0.1:7897 node scripts/cloudflare-proxy-relay.mjs
```

再在另一个终端启动：

```bash
DEMO_CLOUDFLARE_RELAY=1 node scripts/public-demo.mjs
```

若换机器，请将代理地址替换为实际可用地址，或在能直连 Cloudflare 时使用普通启动命令。默认初始化转发端口为 `15191`，TLS 转发端口为 `17844`，均只绑定 `127.0.0.1`。

已有独立生产服务时可加 `--external-server --skip-build`，只启动隧道，结束脚本时也不关闭独立服务。本次执行环境使用独立后台 Node 服务和隧道进程；关闭电脑、系统代理或相应进程均可能中断会议。

脚本保留 `DEMO_TUNNEL=localhost-run` 备选，但其匿名免费域名会在进程仍在线时定期轮换。本轮已实际遇到该限制，故不作为持续会议入口使用。

## 一起开会

1. 参与者打开同一个公开 HTTPS 地址。
2. 一人创建房间，通过页面 **Invite → Copy link** 分享该房间邀请链接。
3. 其他人打开邀请链接、填写名字并加入，再分别允许麦克风或摄像头。
4. 当前房间最多 6 人。视频、语音、共享屏幕由 WebRTC 连接；此 HTTPS 隧道本身不提供 TURN 中继。

手势识别默认只在个人设备上运行；只有主动开启 **Camera** 后才分享摄像头视频。

## 更新和停止

纯前端更新后运行 `npm run build` 即可更新此服务提供的文件，参与者需要刷新页面。服务器代码更新需要重启部署进程；重启时现有房间会结束，重新建立免费隧道也可能生成新地址。

停止时读取 `output/public-demo/state.json` 中的 `pid`，确认它仍属于 `scripts/public-demo.mjs` 后，向该进程发送 `SIGTERM`。脚本会关闭自身会议服务和隧道，不会关闭开发服务。

## 生命周期

- 电脑必须保持开机、联网且未睡眠；退出相关进程后地址失效。
- 这是临时演示入口，没有持续可用保证；每次重新建立隧道都会换地址。
- 房间与聊天只保存在内存中，进程重启后不会恢复。
- 当前工程支持 TURN 环境配置，参见 [部署说明](DEPLOYMENT.md)。没有 TURN 时，复杂 NAT/防火墙下可能出现房间和聊天可用、音视频无法连接的情况。
- 稳定上线应改为持续运行的云主机或固定域名隧道，并配置 TURN；当前脚本没有创建这些收费或账户资源。

官方说明：[localhost.run](https://localhost.run/docs/)、[HTTPS 隧道](https://localhost.run/docs/http-tunnels/)、[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)。
