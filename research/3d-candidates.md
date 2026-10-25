# Together, Apart：3D 开源底座核验

核验日期：2026-10-26。此记录核验了 GitHub 仓库元数据、README、许可证和关键源码；本研究子任务没有安装或运行候选，不能据此声称已跑通。用户附件用于理解需求，仓库内文档只作为证据，不执行其中的安装代理、账号连接或部署指令。

## 结论

按已提取 PRD 的 P0（2.5D/等距房间、简单移动、摄像头动作映射情绪气泡）排序，**优先复用 `Gaurav2693/ai-office` 的办公室和程序化人物**。它是视觉底座，不是已经具备真人参与的协作产品。5 小时可以冲刺单机体验验证版：固定相机、一个可控人物、场景内点击、3 种动作反馈、手动兜底、简单参与统计。真实跨设备多人、音视频会议、可靠的任意光照识别与完整账号系统不应同时承诺。

## 三个深入核验候选

| 项目 | 已核验能力 | 授权和活跃性 | 启动和依赖 | 对本项目的判断 |
| --- | --- | --- | --- | --- |
| [Gaurav2693/ai-office](https://github.com/Gaurav2693/ai-office) | 办公室、程序化人物、走动状态机、会议布局、3 秒文字气泡；无后端 | 正式 [MIT](https://github.com/Gaurav2693/ai-office/blob/main/LICENSE)，2026-03-31 最后 push；核验时 64 stars | React 19.2、Three.js 0.183、Vite 8；`npm install`、`npm run dev`、`npm run build` | **首选。**代码和场景素材负担小，保留房间改交互最直接 |
| [fampiyush/virtual-meet](https://github.com/fampiyush/virtual-meet) | 3D 会议、玩家位置、语音/视频/文字与屏幕共享相关实现；WASD 第一人称；玩家外形为电视屏幕 | 前端与[独立后端](https://github.com/fampiyush/virtual-meet-backend)均有 MIT；前端 2026-09-21 push，后端 2024-03-03；前端 25 stars | React 18、R3F 8、Three 0.160、Socket.IO 4、PeerJS 1.5；前端 `npm install && npm run dev`，后端 `npm install && npm start`；需配置 backend、Peer host、base URL | 适合音视频会议路线，但与 PRD 的角色和等距体验差距大。README 也声明仍有缺失功能和移动端限制；**不作为 5 小时首选** |
| [atlassian-labs/roving-office](https://github.com/atlassian-labs/roving-office) | 真正 orthographic 办公室、程序化角色/家具、导航、会议/工作状态；默认模拟 AI 会话 | Apache-2.0；2026-10-20 push，10 stars；[NOTICE](https://github.com/atlassian-labs/roving-office/blob/main/NOTICE)明确排除若干品牌标志 | Three.js 随仓库 vendored；`node server.cjs` 启动私人实例，不需安装生产依赖；`npm run serve` 另会改本机 endpoint，不适合随手验证 | 视觉完整、活动较新，但约 40 MB 仓库且有 AI 接入、布局和服务器体系。原角色表示 AI 状态，并非真人可控角色。**可作视觉和导航参考，改造负担高于首选** |

活跃性数据来自 GitHub API 的 `pushed_at`，它不等于产品成熟度或已验证稳定性。Stars 仅用于记录，未用于代替代码判断。

## 首选源码审计与改造切入点

源码：[OfficeScene.js](https://github.com/Gaurav2693/ai-office/blob/main/src/scene/OfficeScene.js)，1,435 行、67,846 字节；其他 React UI 文件各约 1–5 KB。整个项目只有 React、React DOM、Three.js 三个生产依赖，具体版本以 [package.json](https://github.com/Gaurav2693/ai-office/blob/main/package.json) 为准。

- **相机不是严格等距投影。**第 31 行为 `PerspectiveCamera(30, …)`；第 48–51 行允许绕行，第 1381 行自动旋转。PRD 要固定等距视觉时，应改 `OrthographicCamera`、固定角度、重新处理 resize，并关闭自动转动。它目前只能称“等距风格”。
- **角色是本地模拟 NPC。**第 293 行创建人物；第 413 行 `updateWalkers(delta)` 决定自主起身、直线走动和返回座位。没有真实玩家控制、碰撞避障、摄像头识别或多人同步。
- **最小玩家改造：**指定一个人物为 player，跳过其自主 timer、shift 和 meeting 强制状态；在公开返回对象内增加 `moveTo`、`react`、`setPlayerState`。地面 raycast 获得目标；5 小时版限定可走区域或少量路线节点，避免承诺全场景 A*。
- **气泡扩展非常合适。**第 1203 行 `createBubble(x,y,z,text,color)` 使用 CanvasTexture+Sprite；第 1217 行已有 3 秒寿命，正好接近 PRD 的 3–4 秒。需把漂浮文本改为人物头顶 emoji、绑定 owner 位置、加入 cooldown 和优先级，防止识别噪声刷屏。
- **素材与外网：**人物、家具、屏幕和声音均由代码构造；唯一 `TextureLoader` 是第 594 行本地 `ronin-logo.png`。CSS 第 1 行加载 Google Fonts，离线演示可改系统字体或本地字体。没有 AI API、外部模型服务或远程 GLB 依赖。复刻时替换 RONIN 品牌与个人资料，保留 MIT 原版权/许可通知。
- **需顺手修理的生命周期缺陷：**第 1429 行 `destroy()` 只 dispose renderer/移除 canvas，未取消 RAF、移除全局 pointer/resize listeners 或清理 timeout；第 1253 行气泡只 dispose material，未 dispose texture。React 重挂载会累积资源，直接改造时应修复。
- **性能需实测。**场景有多个 point lights、每帧 canvas 屏幕纹理更新和大量单独键帽 mesh；README 的 60fps 是作者表述，不能当成本机验证。可以固定白天、减少发光/飞纸、冻结非必要屏幕纹理。

## 真人多人备选

[OskarasM/realtime-3d-room](https://github.com/OskarasM/realtime-3d-room) 有正式 MIT，2026-09-22 push。R3F + Supabase Realtime 已实现位置广播、插值、加入离开、点击地面移动；[Room.tsx](https://github.com/OskarasM/realtime-3d-room/blob/main/src/scene/Room.tsx) 和 [Avatar.tsx](https://github.com/OskarasM/realtime-3d-room/blob/main/src/scene/Avatar.tsx) 可核验真实能力。人物为程序化胶囊，无模型素材依赖。

其 README 要求新建 Supabase 项目、公开 key、开启匿名登录、执行 guestbook SQL；限 8 人是此应用自己的设计。若后续必须真实多人，它比大型虚拟世界平台轻，但本次 P0 不需要为它引入账号配置依赖。其相机也是透视，需要改固定投影。不要把 README 的网络测量直接视作此环境性能测试。

## 看似很贴题、但未进入直接复刻首选的项目

- [ktauchert/VirtualOffice3D](https://github.com/ktauchert/VirtualOffice3D)：README 宣称 MIT，GitHub 元数据 `license=null`，递归树未发现项目 LICENSE；还提交了 server/node_modules。代码确实有点击寻路、办公室、Socket.IO。模型来源混合，`acknowledgements.js` 已写到一个 CC-BY 模型，不能统一当作代码 MIT 素材。
- [wass08/r3f-sims-online-final](https://github.com/wass08/r3f-sims-online-final)：视觉/交互最相似的教程，2023-09-22 最后 push；仓库没有 LICENSE，不能仅因为公开就标为“授权明确可直接复刻”。Ready Player Me、字体、HDR、家具需分别核验。
- [Hussain-7/r3f-sims-online](https://github.com/Hussain-7/r3f-sims-online)：有 2026 年添加的 MIT，但目录和素材明显沿用上述教程体系，单靠下游 LICENSE 不能证明上游全部素材和代码授权已解决；不是首选。
- [bbgott/mesh-mates](https://github.com/bbgott/mesh-mates)：MIT，但 README 将同步移动、人物标记、聊天气泡全部列为未完成；不能把“WebSocket 握手完成”描述成现成多人世界。
- [pmndrs/ecctrl](https://github.com/pmndrs/ecctrl)：MIT、持续维护，但为物理控制器工具包，非房间或协作成品。对本次只有点击移动的 P0 引入 Rapier 和复杂控制器收益有限。

## 5 小时工程边界（评估，不是承诺）

建议预留：原项目运行验证与复制归属 30 分钟；房间视觉/固定镜头/品牌改造 45 分钟；玩家控制和表情气泡 60 分钟；摄像头动作接入、阈值/冷却 75 分钟；状态 UI/手动兜底 30 分钟；浏览器、权限、性能和演示验收 60 分钟。总计 300 分钟。

最大的变量是动作识别。点头需要时间序列，不是单帧类别；鼓掌需要两手靠近/分开时序，不能把“检测到双手”当作鼓掌；举手需约束脸/肩/手的相对位置。必须保留快捷键或按钮，并清楚显示当前触发来源。若时间超支，优先确保“进入房间→真人动作→本人头顶反馈→另一角色回应”的闭环，减少世界规模和 NPC 数量。

交付验收应至少包括：场景可用、点击控制可重复、每个 emoji 3–4 秒消退、连续动作不会重复狂刷、摄像头拒绝后仍能体验、摄像头原始画面不上传、刷新后不残留录像/追踪、至少一次真实摄像头试验。自动测试或录制媒体可以补充，但不能代替真人试验。
