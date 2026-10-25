# 虚拟办公室开源底座核验

核验日期：2026-10-26（Asia/Taipei）。通过 GitHub connector 读取官方仓库、实际许可证、依赖清单、部署说明及最近提交；通过网页检索核对官方许可解释。未安装或运行以下三个项目，下面的工时是工程判断，不能当作已通过启动或摄像头验收。

## 结论

本次深入核验的 SkyOffice、WorkAdventure、PopSpace 都不能直接复刻成 PRD 要求的摄像头动作反馈 demo。它们擅长空间、聊天、多人同步或共享内容；没有查到现成的“点头 → ✨、鼓掌 → 👏、举手 → ❓”完整闭环。

按主任务解析到的 P0，2.5D / isometric 场景、简单移动、三种摄像头动作和停留 3–4 秒的气泡才是核心，多人同步并非明确 P0。因此，在仅 5 小时预算下，整个办公室平台的登录、通信与部署复杂度很可能比它节省的场景工作更多。建议把下列仓库当作空间交互和状态反馈参考，采用轻量自有场景实现 P0；若后续改成“必须真实多人办公室”，SkyOffice 是这三者中最接近的备选，但要先验证安装并处理素材授权。

| 项目 | 空间形态与已有能力 | 许可事实 | 5 小时适配判断 |
|---|---|---|---|
| [SkyOffice](https://github.com/kevinshen56714/SkyOffice) | Phaser 的 2D 像素办公室；移动、靠近视频、聊天气泡、坐下、屏幕共享、嵌入白板、私密房间 | 根 LICENSE 为 MIT；素材另核；package.json 的 ISC 字段与 LICENSE 不一致 | 最轻的完整办公室备选，但旧依赖修复、素材替换及三种摄像头动作仍需做；不建议用它来承诺完整 P0 的 5 小时交付 |
| [WorkAdventure](https://github.com/workadventure/workadventure) | 2D RPG 办公室；接近聊天、地图和互动内容；成熟自托管结构 | play/back 为 AGPLv3 + Commons Clause，官方明确非 OSI 开源；地图素材另有许可 | 可做现成平台与地图体验，整个 fork 改造不是本次最短路径；部署成本大，动作识别仍缺 |
| [PopSpace](https://github.com/with-labs/popspace) | 自由 2D 协作画布；视频、内容小组件、共享文档、白板 | 根 LICENSE 为 GPLv2；noodle 子目录另有 Apache 2.0 | 形态与 isometric 角色场景差距大，服务多且旧；不推荐本次 5 小时 demo |

## SkyOffice

**已验证的功能与结构。** 官方 README 列出靠近即视频聊天、实时文字气泡、屏幕分享、私密房间、通过 iframe 嵌入 WBO 白板。控制为 WASD / 方向键移动、E 坐下、R 使用电脑。它是二维 Phaser 场景，不是真 3D。[README](https://github.com/kevinshen56714/SkyOffice/blob/master/readme.md)

**安装路径。** README 要求 Node / npm，实际命令使用 Yarn：根目录 `yarn && yarn start` 运行 Colyseus 服务，client 中 `yarn && yarn dev` 运行前端。客户端默认连接同主机的 2567 端口，生产环境可设置 VITE_SERVER_URL。视频代码调用 `new Peer(sanitizedId)`，没有显式自托管 PeerJS host 或 TURN 配置，因此不能据此保证限制网络下的视频连通性；完整白板依赖外部 WBO 服务或另行部署。[网络代码](https://github.com/kevinshen56714/SkyOffice/blob/master/client/src/services/Network.ts)、[WebRTC 代码](https://github.com/kevinshen56714/SkyOffice/blob/master/client/src/web/WebRTC.ts)

**依赖年代。** 客户端声明 Vite 3、React 18、Phaser 3.55、PeerJS 1.3、Colyseus 0.14；服务端含 bcrypt 5、ts-node-dev 1、TypeScript 4.8。这说明在新 Node / macOS 环境中的安装兼容性必须实测，不能把 README 的两条命令当成已经成功。[客户端 package.json](https://github.com/kevinshen56714/SkyOffice/blob/master/client/package.json)、[根 package.json](https://github.com/kevinshen56714/SkyOffice/blob/master/package.json)

**实际许可。** 根 [LICENSE](https://github.com/kevinshen56714/SkyOffice/blob/master/LICENSE) 是 MIT，版权为 2021 Kuan-Hsuan Shen，应保留版权及许可文本。package.json 仍标 ISC，与实际许可证有元数据不一致。README 感谢 LimeZu，仓库含 `Modern_Office_Black_Shadow.png` 等素材，但没有查到独立的素材许可说明。LimeZu 的 [Modern Office 官方页面](https://limezu.itch.io/modernoffice) 将项目使用、素材分发和署名分别规定；因此不能把仓库 MIT 自动解释为所有图块、角色和素材均可单独重发。尚未逐文件确定素材对应哪个购买版本；若用作公开可下载 demo，稳妥方案是换成自制 / 已明确授权素材，或先取得对应使用权。

**维护证据。** 截至检索，默认分支最新提交为 2025-12-20 的 README 网站链接修改：[3f66b8b](https://github.com/kevinshen56714/SkyOffice/commit/3f66b8bffad889ee9fc2340f9bcad28146299f47)。其前两条代码提交为 2024-02-20 和 2024-02-17 的 getRoomId 修复；不能仅凭 2025 年更新时间称它持续积极维护。[最近提交](https://github.com/kevinshen56714/SkyOffice/commits/master/)

**5 小时判断（未实测）。** 仅做“办公室能走、两页连接、聊天、替换品牌”有机会；若同时要求新视觉、稳定点头 / 鼓掌 / 举手识别、完善摄像头失败态，时间容易被旧栈安装与通信问题消耗。只有真实多人升为 P0，才值得把它提到主方案。若选它，应设 30–45 分钟启动止损点。

## WorkAdventure

**已验证的功能与结构。** 官方说明为带角色、靠近触发视频的协作空间，浏览器使用、无需 VR。当前 play 包使用 Phaser 4.2。它的 2D RPG 外观与 Gather 路线相近，不能称作真正的 3D 工作空间。[README](https://github.com/workadventure/workadventure/blob/master/README.md)、[play/package.json](https://github.com/workadventure/workadventure/blob/master/play/package.json)

**部署。** 本地开发文档为复制 `.env.template` 后 `docker-compose up`，带 OIDC mock。当前默认 compose 包括 Traefik、play、maps、back、map-storage、uploader、messages、Redis、Redis Insight、icon 服务、OIDC mock、Matrix Synapse 等。生产文档要求域名和 HTTPS；大于 4 人的音视频建议 LiveKit，小群和限制网络还需 Coturn 配置。文档也有 Jitsi 的后续配置段，依赖组合应以固定 release 的实际配置为准。[开发 compose](https://github.com/workadventure/workadventure/blob/master/docker-compose.yaml)、[生产部署](https://github.com/workadventure/workadventure/blob/master/contrib/docker/README.md)

**实际许可。** [play/LICENSE.txt](https://github.com/workadventure/workadventure/blob/master/play/LICENSE.txt) 与 [back/LICENSE.txt](https://github.com/workadventure/workadventure/blob/master/back/LICENSE.txt) 均明确 AGPL Version 3 + Commons Clause，并非无额外限制的 AGPL。其 [官方 FAQ](https://workadventu.re/faq/is-workadventure-open-source/) 明确许可证不符合 OSI；可以读、改和自托管，不应描述成可以任意改名收费出售的完全开源 SaaS 底座。修改版本对外提供服务时还需按许可处理源码提供等要求。

**素材独立。** [map-starter-kit/LICENSE.assets](https://github.com/workadventure/map-starter-kit/blob/master/LICENSE.assets) 要求按 tilesetCopyright 核对；其中 WorkAdventure specific resources 仅可用于 WorkAdventure 地图，禁止把独立素材用于其他程序。因此不能从它的地图中任意抽取图块放入另一个 Three.js demo。

**维护证据。** 默认分支最新提交为 2026-10-23 的录音功能提交 [ef1f19e](https://github.com/workadventure/workadventure/commit/ef1f19ebab18627a038405e01dbc0cd12bd52e0b)，有较新开发活动。活跃维护不等同于 5 小时可完成定制。

**5 小时判断（未实测）。** 若目标只是演示空间互动，可利用已有服务 / 地图工具快速准备体验；若要自托管 fork 加摄像头识别，依赖和调试面过大。本次不作为第一选择。

## PopSpace

**已验证的功能与结构。** 官方定位是聊天、协作和游戏的虚拟画布；自由摆放内容和共享文档，与角色在立体办公室中走动不是同一个产品形态。客户端是 React / Konva 的二维画布。[README](https://github.com/with-labs/popspace/blob/main/README.md)、[noodle/package.json](https://github.com/with-labs/popspace/blob/main/noodle/package.json)

**服务依赖。** README 的必需项是 LiveKit 自托管服务、LiveKit Cloud 或 Twilio 三选一；UI、API、Socket、协作文档占 8888–8891 四个端口，SQLite 存储，协作文档包装 ShareDB。提供 Docker 镜像路径，但本次没有拉取镜像验证它是否仍可直接运行。自建 Dockerfile 基于 Node 16，前端为 CRA 4 / React 17，故在现代环境中存在依赖老化成本。S3 是可选项，不应误写成必需。[Dockerfile](https://github.com/with-labs/popspace/blob/main/Dockerfile)

**实际许可。** 根 [LICENSE](https://github.com/with-labs/popspace/blob/main/LICENSE) 为 GNU GPL Version 2；子应用 [noodle/LICENSE](https://github.com/with-labs/popspace/blob/main/noodle/LICENSE) 为 Apache 2.0，noodle/package.json 也标 Apache-2.0。属于多许可树，不能用一个标签概括全部文件。尚未做逐文件素材授权审计。

**维护证据。** 默认分支最新提交为 2023-11-20 的合并 [a9eab7b](https://github.com/with-labs/popspace/commit/a9eab7b6ac475dbca060e5293a86acb5985fab2c)。它尚未被仓库元数据标记 archived，但不能因此说它仍活跃维护。

**5 小时判断（未实测）。** 在已有 LiveKit 和 Docker 运行环境时可能快速展示原版画布；改成 isometric 办公室再加入三种动作识别，几乎没有明显复用收益。不推荐本次使用。

## 本次评估的边界

- 已做：官方源码及文档检索、实际许可阅读、依赖和部署结构核验、最近提交核验、与 PRD P0 的需求差异判断。
- 未做：npm / Yarn 安装、构建、运行、两浏览器同步、摄像头或音视频实测、网络穿透、浏览器性能测试、逐文件素材版权审计。
- 这三者没有证据表明现成支持完整的三种动作气泡闭环。该能力应计入新开发，而不能作为“开源复刻已经拥有”的功能。
- 对用户当前目标，优先评估轻量 2.5D 场景 + 本地视觉模型动作识别；若需空间中其他角色，可以先明确采用脚本演示角色，不能把它冒充真人多人在线。
