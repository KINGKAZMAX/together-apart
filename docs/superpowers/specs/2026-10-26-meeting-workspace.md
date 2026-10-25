# Meeting workspace revision

User request: replace the decorative prototype UI with a practical meeting workspace; English by default, switchable Chinese; explain and implement real multiplayer use. Follow-up: bind all three gestures to the selected local avatar and default to a close follow view. “mid” is being clarified; existing MediaPipe remains the known working recognition library.

Visual thesis: warm neutral workspace, dark text, one sage accent, compact navigation, real 3D content taking most of the screen. No marketing headings, decorative cards or purple theme.
Content plan: room header; dominant 3D stage; optional participants/chat/gesture inspector; persistent media/reaction controls; concise join/invite/help dialogs.
Interaction thesis: camera follows the local avatar smoothly; room/focus and zoom controls; shared participant motion and 3.5-second reactions; quick inspector transitions honoring reduced motion.

Architecture: Node HTTP + WebSocket room/signaling server; React session orchestration; Three.js real remote avatars; small-room WebRTC mesh with mic/video/screen tracks. Media owns the webcam; MediaPipe consumes the same stream without stopping meeting video. Every outgoing camera/media action is explicit.

Scope: up to 6 room participants, random room links, presence/pose/reaction/chat/media synchronization, same-room signaling, default-off media, English/Chinese persisted preference, camera error and loading states, working invite/create/join/leave flow. Localhost is explicitly identified as local-only; internet delivery requires HTTPS plus configured TURN for restrictive networks. No claim of internet deployment before deployment exists.

Verification: room server integration tests using real WebSocket clients; media negotiation/resource tests; shared camera ownership regression; UI screenshots and two-browser room/chat/pose/reaction tests; actual RTCPeerConnection media transfer with synthetic streams; prior gesture tests; build and lint. User's prior three-gesture live acceptance remains P0 evidence, not a substitute for regression checks after sharing media ownership.
