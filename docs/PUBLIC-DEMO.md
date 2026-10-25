# 临时公网会议入口

`scripts/public-demo.mjs` 把生产构建与会议服务运行在本机 `127.0.0.1:5190`，通过 Cloudflare Quick Tunnel 提供临时 HTTPS 地址。页面、API 与 WebSocket 使用同一个公网域名。它不暴露 Vite 开发服务，也不需要 Cloudflare 账号或付费资源。

## 启动

先确保安装 Node.js、依赖和 `cloudflared`，然后在项目目录运行：

```bash
node scripts/public-demo.mjs
```

这条命令先构建再启动。需要保持终端进程运行。已有经过验证的 `dist/` 时可加 `--skip-build`。默认本机端口为 `5190`，可设置 `DEMO_PORT` 更改。

让进程在当前终端退出后继续运行：

```bash
mkdir -p output/public-demo
nohup node scripts/public-demo.mjs --skip-build > output/public-demo/runner.log 2>&1 &
```

公开地址显示在日志中，也保存在 `output/public-demo/state.json`。该文件只记录公开地址、进程号和启动时间。`cloudflared.log` 用于排查隧道连接问题。

## 一起开会

1. 参与者打开同一个公开 HTTPS 地址。
2. 一人创建房间，通过页面 **Invite → Copy link** 分享该房间邀请链接。
3. 其他人打开邀请链接、填写名字并加入，再分别允许麦克风或摄像头。
4. 当前房间最多 6 人。视频、语音、共享屏幕由 WebRTC 连接；此 HTTPS 隧道本身不提供 TURN 中继。

手势识别默认只在个人设备上运行；只有主动开启 **Camera** 后才分享摄像头视频。

## 更新和停止

纯前端更新后运行 `npm run build` 即可更新此服务提供的文件，参与者需要刷新页面。服务器代码更新需要重启部署进程；重启时现有房间会结束，Quick Tunnel 也会生成新地址。

停止时读取 `output/public-demo/state.json` 中的 `pid`，确认它仍属于 `scripts/public-demo.mjs` 后，向该进程发送 `SIGTERM`。脚本会关闭自身会议服务和隧道，不会关闭开发服务。

## 生命周期

- 电脑必须保持开机、联网且未睡眠；退出相关进程后地址失效。
- 这是临时演示入口，没有持续可用保证；每次重新建立隧道都会换地址。
- 房间与聊天只保存在内存中，进程重启后不会恢复。
- 当前工程支持 TURN 环境配置，参见 [部署说明](DEPLOYMENT.md)。没有 TURN 时，复杂 NAT/防火墙下可能出现房间和聊天可用、音视频无法连接的情况。
- 稳定上线应改为持续运行的云主机或正式 Cloudflare Tunnel，并配置 TURN；当前脚本没有创建这些收费或账户资源。

官方说明：[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)。
