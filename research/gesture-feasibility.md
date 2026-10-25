# Together, Apart：摄像头互动的 5 小时 Demo 可行性

核验日期：2026-10-26（Asia/Taipei）。本报告是资料与架构评估；没有打开摄像头，没有实际测试用户设备、识别率、帧率或网络部署。以下工时、阈值和验收指标均为工程建议，不是已达成的实测结果。

## 决策

**5 小时可以完成受控演示；不应承诺 5 小时内同时得到三种动作都可靠、多人联网、精细 3D、跨浏览器兼容的成品。** 摄像头模块建议优先做「举手 → ❓」，再做「点头 → ✨」，「鼓掌 → 👏」作为限时尝试。三种互动保留明确标注的按钮/快捷键入口。若鼓掌只通过按钮演示，必须在交付说明写明，不能称为摄像头识别已完成。

这不是直接把 MediaPipe 标签映射到表情即可：官方 Gesture Recognizer 预置的是 Closed_Fist、Open_Palm、Pointing_Up、Thumb_Down、Thumb_Up、Victory、ILoveYou 七种手形；**没有 nod、clap、raise_hand**。VIDEO 模式表示连续视频推理，不代表它已学会鼓掌或点头时序。点头与鼓掌须自行实现时间窗口和状态机；举手也需要判断手相对于身体/头部的位置。[官方 Gesture Recognizer 概览](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer)

## 可以直接复用的开源底层

首选官方 [mediapipe-samples-web](https://github.com/google-ai-edge/mediapipe-samples-web)，抽取摄像头、模型初始化与绘制示例，而不是把整套工具展示页当作协作空间。它提供 [Face](https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/tasks/face-landmarker.ts)、[Hand](https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/tasks/hand-landmarker.ts)、[Pose](https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/tasks/pose-landmarker.ts)、[Gesture](https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/tasks/gesture-recognizer.ts) 示例，仓库标示 Apache-2.0。

2026-10-26 直接读取 npm registry，`@mediapipe/tasks-vision` 的 `latest` 为 **1.1.1**、许可证 Apache-2.0；官方示例 package.json 使用 `^1.1.0`。开工时应锁定选用版本以及同版本 WASM，保存 lockfile，不使用浮动 `@latest`。这只是版本元数据核验，未安装或运行 1.1.1。[npm 包元数据](https://registry.npmjs.org/@mediapipe/tasks-vision/latest)、[官方示例依赖](https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/package.json)

| 底层 | 官方输出 | 对本项目的用途 | 需要补的逻辑 |
|---|---|---|---|
| Face Landmarker | 面部关键点、可选 facial transformation matrix、blendshapes | 从头姿变化识别点头 | 基线校准、pitch 方向/幅度/回归时序；不能把鼻子下降直接等同点头 |
| Hand Landmarker | 每只手 21 个关键点、handedness、image/world 坐标 | 双手鼓掌；配合面部位置判断举手 | 双手跟踪、距离变化、完整往复、遮挡处理 |
| Pose Landmarker | 33 个身体关键点，含肩/肘/腕和 visibility | 肩部入镜时，用手腕高于肩/头作为举手条件 | 持续时间、回落复位；坐姿裁切需实测 |
| Gesture Recognizer | 静态手形类别与手部关键点 | 可选用 Open_Palm 辅助判断举手 | Open_Palm 本身并不说明手被举高；仍须位置与时序规则 |

依据：[Face Web 文档](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)、[Hand Web 文档](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js)、[Pose Web 文档](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)、[Gesture Web 文档](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer/web_js)。

最低模型组合建议为 **Face + Hand**：正面坐姿的头和手比较容易留在摄像头画面内；通过手掌/手腕相对脸部高度判定举手，避免第一版同时加载三套任务。若现场 Pose 的肩腕关键点稳定，可用 Pose 统一举手与粗粒度双腕运动，再用 Face 做点头。不能假定全身姿态模型在只露头肩的笔电画面中一定稳；官方 Pose 模型面向全身姿态，手模型也明确说明遮挡、模糊和极端光线会降低可靠性。[Pose 模型卡](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)、[Hand 模型卡](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20(Lite_Full)%20with%20Fairness%20Oct%202021.pdf)

## 最低可行识别规则

以下为待校准方案，不是 Google 的预置功能或官方阈值。

| 动作 | 最低演示实现 | 防误触发与边界 |
|---|---|---|
| 举手 → ❓ | 单手完整入镜、手腕及掌心高于脸部参考线，持续约 0.6–0.8 秒后触发；肩部可靠时可改用腕高于肩且接近头高 | 须先回落 0.4 秒才重新触发；不能手一直举着每帧刷表情；整理头发/喝水也可能误触，保留快速关闭识别开关 |
| 点头 → ✨ | 开启 1 秒正视基线校准；用 transformation matrix 提取 pitch，检测一次明确的低头后回正，约 0.25–1.2 秒完成 | 从约 10–15° 幅度起调；限制 yaw/roll、排除整个人靠近/远离造成的尺度突变；丢脸后清空窗口并重新稳定；不做情绪或赞同心理状态推断 |
| 鼓掌 → 👏 | 两手都检测到，用图像坐标的掌心距离，除以掌宽或肩宽归一化，识别「远 → 近 → 远」往复；受控演示建议缓慢拍两次后只触发一次 | 双手交叠最容易丢点；丢失不能当成距离为零，不能只凭手靠近一次就算鼓掌；匹配连续轨迹而非依赖左右手标签绝对稳定；不在 5 小时内加麦克风声学识别 |

通用规则：只处理新视频帧；按毫秒而不是固定帧数计时；坐标先平滑；设 2–3 秒全局冷却；一段动作只发送一个事件；丢失目标、切后台、摄像头停止时复位；当前正在判定鼓掌时抑制同时触发举手。模型检测阈值和业务动作阈值分开设置，模型的 tracking confidence 也不能解释成「鼓掌置信度」。

气泡表现与识别解耦：本机事件形如「参与者、反应类型、事件 ID、触发时间、来源 camera/manual」，渲染层在角色头顶显示 3.5 秒，再淡出。重复事件按 ID 去重，同角色同时只保留一个反应。2.5D 只需要角色的屏幕坐标；真正 3D 可把头顶锚点投影至屏幕，工作量不应消耗在真人骨骼驱动上。

## 权限、下载、性能与离线

摄像头使用需 HTTPS 或 localhost，并由用户在页面明确开启。跨域 iframe 还需要宿主的 Permissions Policy 授权；最稳妥的演示方式是浏览器顶层页面。只申请 video，不申请 microphone；拒绝权限、设备不可用或被其他程序占用时提示原因并保留手动入口，停止时释放媒体轨道。[MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

官方 Web 指南当前列 Chrome / Safari。建议 5 小时版以桌面 Chrome 为验收环境，Safari 至少做启动冒烟检查；未验证的浏览器不写为已支持。[官方 Web 设置](https://developers.google.com/edge/mediapipe/solutions/setup_web)

模型、WASM 与 JS 可以由自己的站点提供。官方文档允许模型相对/绝对路径或内存 buffer；官方示例还带 [copy-wasm.js](https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/copy-wasm.js)，把依赖中的 WASM 资源复制到 public/wasm。建议资源同源、锁版本、开工即预下载，并显示加载状态，避免演示现场依赖 Google Storage 或 jsDelivr 临时可达。

本次仅用 HEAD 核验官方固定版本模型 URL，均 HTTP 200：Face v1 3,758,596 bytes，Hand v1 7,819,105 bytes，Pose Lite v1 5,777,746 bytes；Face + Hand 约 **11.58 MB**，三者约 17.36 MB，另需 JS/WASM。尺寸不等于实际压缩网络流量，未下载并运行。来源为 [Face v1](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task)、[Hand v1](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task)、[Pose Lite v1](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task)。

**本地推理可以离线自托管，但不能仅凭「on-device」宣称整站完全零外联。** 官方现行条款明确输入图像/视频在设备上处理、不上传给 Google，同时说明 SDK 可能联系服务并发送性能/使用指标。因此应区分「应用不上传摄像头帧」与「没有任何遥测/外部请求」；后者必须针对固定构建用网络日志及断外网测试证实。多人同步需要连接自己的服务器，也与摄像头离线识别是两个层次。[MediaPipe 当前条款](https://developers.google.com/edge/mediapipe/legal/tos)

Face、Hand、Pose、Gesture Web 推理调用是同步的，会阻塞调用线程。官方建议 Web Worker；第一版可先以 640×480 摄像头输入、每任务约 10–15 次/秒为目标，并轮流执行任务、限制最多一个待处理帧，随后测量。场景渲染不必与检测同频；GPU 与 CPU 都是选项，GPU 还会与 3D 场景争资源。若卡顿则先降推理频率/分辨率，必要时转 Worker；不能用官方 Android/Pixel 模型延迟推导用户浏览器帧率。依据：[Face 的同步调用说明](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)、[硬件 delegate 配置](https://developers.google.com/edge/mediapipe/solutions/setup_web)。

代码和示例仓库为 [Apache-2.0](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE)。已核验 [Face detector](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf)、[Face Mesh V2](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf)、[Blendshape V2](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf)、前述 Hand 与 Pose 官方模型卡均列 Apache License 2.0；复用时保留许可证、版权/NOTICE 与修改说明。素材、空间模板、其他依赖的授权另行核验，不能从 MediaPipe 许可推导整个 Demo 的素材都可复制。

## 工时建议与停止线

以下按熟悉 TypeScript 的开发者、有可运行网页骨架、受控光线、单人面对一台笔电估计；不含 3D 场景、多人的状态服务器、部署和完整美术。

| 摄像头子任务 | 预计用时 |
|---|---:|
| 抽取官方示例、锁版本、模型/WASM 本地化、摄像头状态 | 25–40 分钟 |
| 举手规则、保持/复位、气泡事件接线 | 25–40 分钟 |
| 点头校准与时序、误触发初调 | 35–60 分钟 |
| 鼓掌往复、丢手处理、限时调参 | 35–70 分钟 |
| 手动降级、现场验收、性能/网络检查 | 30–45 分钟 |
| 合计 | **150–255 分钟** |

若整站工期只有 5 小时，建议摄像头限定约 2–2.5 小时，优先保住举手与点头，鼓掌最多试 30 分钟。单个动作未通过下面的最小验收就将其标为实验功能；不足以承诺「全部摄像头 P0 已完成」。多人协作、场景视觉可与识别由不同人员并行。若单人从零把全部内容串行完成，必须进一步缩减场景或摄像头范围。

针对主评估已跑通构建的 `Gaurav2693/ai-office` 场景底座，若坚持三种真实摄像头动作均在本轮交付，判定为 **conditional go**。可用如下完整 300 分钟预算：场景接入/摄像头/资产本地化 30 分钟，角色控制与气泡 35 分钟，三动作 125 分钟（举手 30、点头 40、鼓掌 55），联调与性能/复位 35 分钟，真实摄像头验收与打包 45 分钟，缓冲 30 分钟。这是受控演示的进取预算；原提案只给三动作 100 分钟偏紧，必须把约 25 分钟从其他环节挪给时序与遮挡调参。

阶段停止线：约第 90 分钟应已有可用摄像头、角色气泡与举手；第 190 分钟三动作应全部接通；剩余时间用来验收和修复。鼓掌若首个 30 分钟试验仍无法稳定区分「靠近保持」和「往复拍手」，余下 25 分钟只用于一轮有针对性的修复，不无限调阈值。最终达不到摄像头验收门槛，则应明确报告该动作未通过，保留按钮仅保障汇报演示，不能改变三动作 P0 未完全通过的结论。

## 可执行验收

所有项目目前均 **未执行**，应在实现完成后记录设备、浏览器版本、SDK 版本和结果。

1. 权限：首次进入不自行开摄像头；点击开启后正常弹窗；拒绝后仍可移动角色和发送手动表情；关闭后摄像头指示灯熄灭。
2. 正例：同一演示者在正常室内光、正面对摄像头下，每种启用的动作做 10 次，间隔至少 4 秒。建议 Demo 门槛为每种至少 8/10 次成功；统计漏检、错类、重复触发，而不是只录一段成功视频。该门槛只是演示门槛，不证明产品级准确率。
3. 负例：保持静止、说话、看旁边、低头看键盘、喝水、摸脸、打字各约 30 秒，合计 3.5 分钟。建议总误触发 ≤1 次；若主要假阳性来自日常动作，应提高门槛或停用该自动反应。
4. 时序：举手保持 5 秒只触发一次，放下再举起能再次触发；手掌靠近后保持不算持续鼓掌；人脸/手短暂出画后不补发幽灵事件；冷却期间不重复发送。
5. 反馈：动作完成后到气泡出现建议 ≤1 秒（不含动作本身的保持时间）；气泡显示 3–4 秒、跟随角色，网络事件重复时不重复播放。
6. 负载：同时移动角色和启用识别 2 分钟，场景目标 ≥30 FPS、按钮及时响应，无持续增长的待推理队列；记录实际 p95 帧耗时/推理耗时，达不到则降采样后复测。
7. 自托管：冷启动时记录所有模型/WASM 请求均成功且版本一致；只阻断外部网络、保留本地/自有站点可达，再重新加载并确认能启动识别。完整断网后重新打开远程站点还需要 Service Worker 缓存，这不属于仅「资源自托管」自动提供的能力。
8. 双端：如果 Demo 包含多人，两个独立浏览器会话中，A 的 camera/manual 事件都应使 B 看到 A 头顶的同一反应，且 B 的气泡不被覆盖；两标签同进程模拟应明确标识为模拟。

无需训练自定义模型即可做上述受控 Demo，但最终可行性仍须真实摄像头实测确认。
