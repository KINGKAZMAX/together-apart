# Together, Apart — Design asset library

[Open the editable Figma library](https://www.figma.com/design/rYwJyavMnJw3WJAYnmWAh7)

Destination: **2025設計項目**. Created 2026-10-26.

| Page | Contents |
| --- | --- |
| 00 · Overview | Product cover and library index |
| 01 · Foundations | 36 variables in two collections, nine text styles, one effect style, layout and accessibility notes |
| 02 · Components | 58 main components, nine variant sets, 21 editable SVG icons, text and icon properties |
| 03 · Desktop · EN & 中文 | Four editable 1440 × 900 views: preview, Chinese room, gestures and chat |
| 04 · Mobile | Four editable 390 × 844 views, overlay inspectors and meeting controls |
| 05 · Characters & Assets | Four separate character images, GLB specifications, 32-clip inventory and studio image asset |
| 06 · Flows & Motion | Feature framework, room and gesture lifecycles, recovery states, thresholds, motion values and four linked motion frames |

UI text, controls, surfaces and icons remain native editable layers. Character previews and the Three.js scene are discrete image assets; no complete UI screen was flattened into an image. GLB models remain in `public/models/` for runtime use. Figma does not execute webcam recognition, WebRTC or 3D gameplay.

The interface follows `src/index.css`, `src/App.jsx`, `src/i18n.js` and `src/components/Icon.jsx`. Motion documentation follows `src/scene/WorkshopScene.js` and `src/vision/gesture-engine.js`. Noto Sans SC substitutes for the browser’s PingFang SC fallback in Chinese Figma text.

Validation: inspected rendered boards for all seven categories and both desktop languages; repaired toolbar and row sizing; verified all 26 prototype links have valid destinations. Final library contains 1,757 nodes, 456 editable text nodes and 346 component instances. A visible-text audit confirmed zero asset-origin, author, licensing or external-origin links after the requested cleanup. Existing repository license files remain unchanged.

`docs/figma/delivery.json` records file and node identifiers. Builder files in `docs/figma/` are creation scripts, not idempotent update commands; do not rerun them against the completed file. The live Figma file is the current delivered artifact. Screenshot checks are under ignored `output/design-assets/`.
