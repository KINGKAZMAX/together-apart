# Together, Apart

一个非 VR 的 3D 会议工作室。默认英文，可切换中文。使用已选定的四个 Kenney CC0 角色，以 MediaPipe 识别点头、鼓掌和举手，并同步给同一房间的参与者。

## 在线演示

[打开会议工作室](https://4fbb40b888a753.lhr.life) · [Figma 设计资产库](https://www.figma.com/design/rYwJyavMnJw3WJAYnmWAh7)

当前是临时 HTTPS 演示入口，本机与隧道须保持在线。三人公网实时交互已检查；仓库保持私密。详见 [公网部署记录](docs/公网部署记录.md)。

## 开始运行

需要 Node.js 20.19+（20.x）或 22.12+，建议使用桌面 Chrome。

```bash
npm install
npm run dev
```

打开 [工作室](http://127.0.0.1:5187/)。这一条命令同时启动前端和会议服务，分别使用 5187、5188 端口。关闭终端中的进程会结束服务与所有房间。

## 如何一起开会

1. 填写 **Your name**，选择 **Your character**。点击 **Create a room** 创建房间。
2. 点击右上角 **Invite → Copy link**。其他参与者打开链接，确认名字与角色后点击 **Join a room**。也可以直接粘贴完整邀请链接或房间代码加入。
3. 点击底部 **Microphone** 开启语音；点击 **Camera** 分享摄像头视频。两者在加入时都默认关闭。房间最多 6 人。
4. **Gestures** 可以单独开启：识别在本机运行，不会自动把视频分享给其他人。开启 **Camera** 时会同时开启手势识别；单独关闭手势不影响已开启的视频。
5. **Share screen** 使用浏览器的屏幕选择器。停止共享会恢复原来的视频分享状态，并保留麦克风状态。
6. 左侧 **People / Chat / Gestures** 切换参会者、文字聊天和识别面板。**Leave** 离开并释放本次会话的设备与连接。

**当前 localhost 地址只能用于这台电脑。** 本机可用两个浏览器窗口体验真实双人房间，分别填写不同名字。让其他电脑加入，需要把同一应用部署到共同可访问的 HTTPS 地址；不能把 `127.0.0.1` 当作远程邀请地址。部署方式见 [部署说明](docs/DEPLOYMENT.md)。

## 动作、角色和视角

| 输入动作 | 角色反馈 | 做法 |
| --- | --- | --- |
| 点头 | ✨ | 正视完成校准后，低头再回正。 |
| 鼓掌 | 👏 | 双手完整入镜，从分开到拍合，再分开。 |
| 举手 | ❓ | 手腕举过眼睛，保持约一秒后放下。 |

每次动作间隔约 3 秒。识别面板可查看面部/手部状态并 **Recalibrate**。识别成功后的表情绑定本人的角色，并同步给房间中其他人，停留 3.5 秒后消失。

- 当前角色：Alex、Maya、Jordan、Sam；侧栏或个人资料中可切换。
- 默认近景跟随本人。**Focus on me** 聚焦自己，**Room view** 查看全屋，`+ / −` 缩放。
- 点击地面或 `W A S D` / 方向键移动；`1 / 2 / 3` 手动触发表情；`F` 全屏。
- 顶部 **EN / 中文** 切换语言；选择会保留。切换语言不会退出房间。
- [角色预览](http://127.0.0.1:5187/models.html) 提供旋转、缩放和五种动画预览，也支持中英文。

未加入房间时，其他三个角色明确标为示例；加入后只显示真实参与者。房间在最后一个人离开时删除，聊天只保留当前进程内最近 50 条，不保存会议录像。

## 摄像头与音视频

MediaPipe 的模型和 WASM 由本地静态资源加载。**Gestures** 只做本机识别，向房间发送动作事件；**Camera / Microphone / Share screen** 分别控制经 WebRTC 传输的视频、音频和屏幕。浏览器必须允许相应设备权限。

音视频使用小房间 WebRTC mesh；成员之间两两连接。公网网络条件复杂，生产环境应配置 TURN 中继。服务器默认提供 STUN 配置，但这不保证所有跨网络场景都能直连。

P0 的三动作真人功能验收已由用户于 2026-10-26 确认，见 [原始验收记录](docs/P0-验收记录.md)。这不是跨设备、跨光照的统计准确率。多人版本的测试记录另见 [会议版验证记录](docs/会议版验证记录.md)。

## 检查与构建

```bash
npm test
npm run lint
npm run build
```

构建生成 `dist/`。会议服务器可在生产模式同时提供页面、API 与 WebSocket：

```bash
npm start
```

默认地址为 `http://127.0.0.1:5188/`，可通过 `HOST` 和 `PORT` 调整。普通远程 HTTP 无法使用摄像头或麦克风；公网部署需 HTTPS。

`node scripts/meeting-smoke.mjs` 在运行中的开发服务上使用两个独立测试浏览器验证会议；摄像头、麦克风与屏幕输入均为合成测试源，不访问真人设备。测试需要已安装的 Playwright Chromium。

## 代码与来源

- `src/App.jsx` / `src/index.css`：会议界面与样式。
- `src/i18n.js`：界面语言及本地偏好。
- `src/useWorkspace.js`：场景、房间、媒体与手势的整合。
- `src/scene/WorkshopScene.js`：真实参与者、近景相机、移动和气泡。
- `src/vision/`：本机识别与摄像头流归属。
- `src/network/`：房间客户端与 WebRTC 媒体。
- `server/index.js`：房间、信令与静态资源服务。

场景基础参考 [AI Office](https://github.com/Gaurav2693/ai-office)（MIT），角色使用 [Kenney Mini Characters](https://kenney.nl/assets/mini-characters)（CC0）。MediaPipe 模型及运行库按 Apache 2.0 提供。原许可与来源记录见 `licenses/`，发行包保留 `public/licenses/`。
