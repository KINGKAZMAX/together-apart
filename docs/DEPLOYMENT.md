# 让不同电脑加入同一个会议

当前开发入口 `http://127.0.0.1:5187/` 只属于运行项目的这台电脑。公网会议需要同一个 HTTPS 站点、持续运行的 Node 服务，以及适用于参与者网络的 TURN 中继。工程已支持这些配置，本轮未创建公网域名或已部署的公开会议链接。

## 部署 Node 服务

在具备 Node.js 的主机上放入项目，安装依赖并构建：

```bash
npm ci
npm run build
HOST=0.0.0.0 PORT=8080 npm start
```

使用 HTTPS 反向代理指向该端口，必须支持 WebSocket 升级。页面、`/api/*` 和 `/socket` 使用同一外部域名，静态模型位于 `/models` 和 `/wasm`。部署在域名根路径。重启进程会结束已有房间；目前是内存房间，不支持多进程负载均衡共享状态。

## 配置 TURN

服务器读取以下环境变量：

| 变量 | 用途 |
| --- | --- |
| `TURN_URLS` | 逗号分隔的 `turn:` / `turns:` 地址 |
| `TURN_USERNAME` | 提供给 WebRTC 客户端的 TURN 用户名 |
| `TURN_CREDENTIAL` | 提供给 WebRTC 客户端的 TURN 凭据 |
| `ALLOWED_ORIGINS` | 可选，逗号分隔的额外允许的页面来源 |

服务器经 `/api/config` 向浏览器提供 ICE 配置。TURN 凭据会按 WebRTC 连接的需要交给浏览器，不可把管理员凭据、云服务主密钥或其他无关秘密放入这些变量。公开部署宜使用有期限的 TURN 凭据及中继额度限制；当前示例服务器读取固定环境配置。

未配置 TURN 时只使用默认 STUN；某些网络可以直连，某些防火墙/NAT 组合需要中继。浏览器音视频失败时，角色与文字同步可能仍可用。

## 使用步骤

1. 两位参与者从不同设备打开同一 HTTPS 网站。
2. 一人创建房间，再把 **Invite** 中的链接发送给其他人。
3. 对方打开链接或粘贴链接加入，分别确认名字与角色。
4. 按需开启麦克风、摄像头或屏幕共享。手势可独立开启，只在本机处理画面。
5. 检查远端角色移动、三种表情、文字、声音与视频。至少在两个不同网络下测试一次 TURN 回退。

当前原型最多 6 人，不含账户、主持人审批、录制或持久聊天。获得随机房间链接的人可以加入，直到所有人离开。

协议依据：[WebRTC peer connections](https://webrtc.org/getting-started/peer-connections)、[TURN server](https://webrtc.org/getting-started/turn-server)、[MDN perfect negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation)。
