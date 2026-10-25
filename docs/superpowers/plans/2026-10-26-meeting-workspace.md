# Meeting workspace implementation

Goal: functional small-room meetings with a restrained EN/ZH UI and close local-avatar camera.

- [x] server/index.js, src/network/meeting-client.js, tests/rooms.test.js: room protocol, safe same-room signaling, real WebSocket tests.
- [x] src/network/media-client.js, tests/media-client.test.js: negotiation, mic/camera/screen controls, default off, cleanup and cancellation tests.
- [x] src/scene/WorkshopScene.js: authoritative remote avatars, reactions, close following camera, avatar selection, localized scene labels.
- [x] src/vision/camera-controller.js: consume externally owned camera without stopping/clearing it; meaningful regression tests.
- [x] src/App.jsx, src/components, src/i18n.js, src/index.css: working room UI, invites, media, sidebar/chat, default English and persistence.
- [x] scripts/dev.mjs, vite.config.js, package.json: single dev command, proxy and production server.
- [x] Browser tests for two peers, gestures mapping, selected avatar/follow/zoom, EN/ZH, responsive view, real WebRTC synthetic media.
- [x] npm test, npm run lint, npm run build, screenshot review, updated how-to/deployment docs.
