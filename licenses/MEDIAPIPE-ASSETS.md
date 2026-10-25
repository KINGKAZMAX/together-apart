# MediaPipe 运行库、WASM 与模型授权

核验日期：2026-10-26。提供者为 Google / The MediaPipe Authors。运行库、WASM 与下列人脸、手部预训练模型分别按官方来源核验，许可均为 **Apache License 2.0**。本记录不使用开发者文档页脚的示例代码许可来替代模型许可；模型许可依据是官方模型卡的「LICENSED UNDER」条目。

## 运行库与 WASM

| 项目 | 固定版本 | 项目内位置 | 来源 |
| --- | --- | --- | --- |
| MediaPipe Tasks Vision | `@mediapipe/tasks-vision 1.1.1` | npm 依赖，由 Vite 打包 | [npm 版本页](https://www.npmjs.com/package/@mediapipe/tasks-vision/v/1.1.1)、[官方源码](https://github.com/google-ai-edge/mediapipe/tree/master/mediapipe/tasks/web/vision) |
| WebAssembly 与配套加载器 | 同一 npm 版本 `1.1.1` | `public/wasm/vision_wasm_internal.{js,wasm}`、`vision_wasm_module_internal.{js,wasm}`、`vision_wasm_nosimd_internal.{js,wasm}` | 原包的 `wasm/` 目录 |

六个本地 WASM / JS 文件均与已安装 npm 包逐字节一致，没有修改。包内 `package.json` 明确声明 `Apache-2.0`，`vision.d.ts` 保留 The MediaPipe Authors 的 2022、2023 年版权声明与 Apache 许可头。

这个 npm 发布包没有单独附带 `LICENSE` 文件，因此：

- 原样保存其本地版权与许可头至 [MEDIAPIPE-PACKAGED-NOTICES.txt](MEDIAPIPE-PACKAGED-NOTICES.txt)。
- 从 [MediaPipe 官方仓库 LICENSE](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE) 获取完整文本，原样保存至 [MEDIAPIPE-APACHE-2.0.txt](MEDIAPIPE-APACHE-2.0.txt)。

## 本地模型

下列模型来自官方 `mediapipe-models` 存储桶，使用固定的 `float16/1` 版本路径。核验时重新读取官方固定版本文件，与本地文件逐字节一致；没有转换或修改权重。

| 本地文件 | 版本 | 文件大小 | 官方原始文件 |
| --- | --- | ---: | --- |
| `public/models/face_landmarker.task` | Face Landmarker float16 v1 | 3,758,596 字节 | [face_landmarker.task](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task) |
| `public/models/hand_landmarker.task` | Hand Landmarker float16 v1 | 7,819,105 字节 | [hand_landmarker.task](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task) |

SHA-256：

```text
64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff  face_landmarker.task
fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1  hand_landmarker.task
```

### 人脸模型的许可依据

[官方 Face Landmarker 模型说明](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker#models) 将检测、网格和表情系数组件列为同一模型包，并链接以下三张模型卡。三者的首页均明确写明 Apache License, Version 2.0：

- [BlazeFace Short Range 模型卡](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20%28Short%20Range%29.pdf)：模型作者 Valentin Bazarevsky / Google；模型卡日期 2021-06-09。
- [Face Mesh V2 模型卡](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf)：模型作者 Geng Yan、Ivan Grishchenko / Google；模型日期 2022-09-15。
- [Blendshape V2 模型卡](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf)：模型作者 Ivan Grishchenko、Geng Yan、Andrei Zanfir、Eduard Gabriel Bazavan / Google；模型日期 2022-11-11。

这些模型日期描述上游模型卡，不等同于当前 npm 包版本或模型文件路径中的 v1。

### 手部模型的许可依据

[官方 Hand Landmarker 模型说明](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker#models) 说明模型包包含手掌检测与手部关键点模型，并链接 [Hand Tracking（Lite / Full）模型卡](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf)。该模型卡第 2 页明确写明 Apache License, Version 2.0。

## 使用范围与再分发

项目从本站 `models/` 与 `wasm/` 目录加载这些资源，在浏览器内进行关键点推理。项目自己的点头、举手、鼓掌判断属于关键点上的时序规则；上游模型卡的性能数值不能当作本项目的真人动作识别准确率。

这些第三方文件保持其 Apache 2.0 许可，未重新许可为项目的 MIT 资源。再分发相关运行库、WASM 或模型时，随分发保留完整许可及适用的版权声明；若后续修改这些文件，应注明修改。该文档和配套许可应随项目源码或发行包一同保存。
