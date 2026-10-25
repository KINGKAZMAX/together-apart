import test from 'node:test'
import assert from 'node:assert/strict'
import { createGestureEngine } from '../src/vision/gesture-engine.js'
import { createCameraController, landmarksToFrame } from '../src/vision/camera-controller.js'

const face = (pitch = 0, extra = {}) => ({ pitch, yaw: 0, roll: 0, raiseLine: 0.4, scale: 0.2, ...extra })
const hand = (id, x, y = 0.65) => ({ id, palm: { x, y }, wrist: { x, y: y + 0.04 }, scale: 0.1 })
const pair = distance => [hand('Left', 0.5 - distance / 2), hand('Right', 0.5 + distance / 2)]

function rig({ calibrated = true } = {}) {
  const engine = createGestureEngine()
  const events = []
  let timestamp = 0
  const step = (changes = {}, delta = 100) => {
    timestamp += delta
    events.push(...engine.process({ timestamp, face: face(), hands: [], ...changes }))
  }
  const hold = (changes, count) => { for (let i = 0; i < count; i++) step(changes) }
  if (calibrated) hold({}, 14)
  return { engine, events, step, hold }
}

test('calibration requires a stable, continuously visible face before emitting gestures', () => {
  const r = rig({ calibrated: false })
  r.hold({ face: null, hands: [hand('Left', 0.2, 0.2)] }, 20)
  assert.equal(r.engine.getState().calibrated, false)
  r.hold({ face: face() }, 7)
  r.step({ face: null })
  r.hold({ face: face() }, 7)
  assert.equal(r.engine.getState().calibrated, false)
  r.hold({ face: face() }, 7)
  assert.equal(r.engine.getState().calibrated, true)
  assert.deepEqual(r.events, [])
})

test('unstable calibration cannot silently select a moving pitch baseline', () => {
  const r = rig({ calibrated: false })
  for (let i = 0; i < 30; i++) r.step({ face: face(i % 2 ? 15 : 0) })
  assert.equal(r.engine.getState().calibrated, false)
  r.hold({}, 14)
  assert.equal(r.engine.getState().calibrated, true)
})

test('a deliberate dip and return emits exactly one nod with camera provenance', () => {
  const r = rig()
  for (const pitch of [0, 4, 10, 17, 19, 13, 7, 2, 0]) r.step({ face: face(pitch) })
  assert.equal(r.events.length, 1)
  assert.equal(r.events[0].type, 'nod')
  assert.equal(r.events[0].source, 'camera')
  assert.ok(Number.isFinite(r.events[0].timestamp))
})

test('pitch noise, an upward glance, side turn, and a prolonged bow do not count as nods', () => {
  const r = rig()
  for (const pitch of [0, 3, -4, 5, 0, -20, -10, 0]) r.step({ face: face(pitch) })
  for (const pitch of [0, 15, 20, 4, 0]) r.step({ face: face(pitch, { yaw: 45 }) })
  r.hold({ face: face(20) }, 30)
  r.hold({}, 3)
  assert.deepEqual(r.events, [])
})

test('nod cooldown suppresses repeats and a missing face cancels an incomplete nod', () => {
  const r = rig()
  const nod = () => { for (const pitch of [0, 17, 20, 10, 2, 0]) r.step({ face: face(pitch) }) }
  nod(); nod()
  assert.equal(r.events.length, 1)
  r.hold({}, 22)
  r.step({ face: face(20) })
  r.step({ face: null })
  r.step({ face: face(0) })
  assert.equal(r.events.length, 1)
  nod()
  assert.equal(r.events.length, 2)
})

test('raise requires 600ms, stays latched while held, and rearms after lowering', () => {
  const r = rig()
  const raised = { hands: [hand('Left', 0.2, 0.2)] }
  r.hold(raised, 6)
  assert.equal(r.events.length, 0)
  r.step(raised)
  assert.equal(r.events[0]?.type, 'raise')
  r.hold(raised, 40)
  assert.equal(r.events.length, 1)
  r.hold({ hands: [hand('Left', 0.2, 0.65)] }, 4)
  r.hold(raised, 7)
  assert.equal(r.events.length, 2)
})

test('lowering a hand outside the frame for four seconds permits the next deliberate raise', () => {
  const r = rig()
  const raised = { hands: [hand('Left', 0.2, 0.2)] }
  r.hold(raised, 7)
  assert.deepEqual(r.events.map(e => e.type), ['raise'])
  r.hold({ hands: [] }, 40)
  r.hold(raised, 6)
  assert.equal(r.events.length, 1, 'reappearing still requires a complete 600ms hold')
  r.step(raised)
  assert.deepEqual(r.events.map(e => e.type), ['raise', 'raise'])
})

test('short hand dropouts never rearm an already raised hand, even after cooldown expires', () => {
  const r = rig()
  const raised = { hands: [hand('Left', 0.2, 0.2)] }
  r.hold(raised, 35)
  for (let i = 0; i < 4; i++) {
    r.hold({ hands: [] }, 6)
    r.hold(raised, 2)
  }
  r.hold(raised, 15)
  assert.deepEqual(r.events.map(e => e.type), ['raise'])
})

test('a suspended frame loop does not count as continuous missing-hand evidence', () => {
  const r = rig()
  const raised = { hands: [hand('Left', 0.2, 0.2)] }
  r.hold(raised, 35)
  r.step({ hands: [] })
  r.step({ hands: [] }, 4000)
  r.hold(raised, 10)
  assert.deepEqual(r.events.map(e => e.type), ['raise'])
})

test('missing hands, a different hand, and fingers alone above the face do not complete a raise', () => {
  const r = rig()
  r.hold({ hands: [hand('Left', 0.2, 0.2)] }, 4)
  r.step({ hands: [] })
  r.hold({ hands: [hand('Left', 0.2, 0.2)] }, 4)
  r.hold({ hands: [hand('Right', 0.8, 0.2)] }, 4)
  r.hold({ hands: [hand('Right', 0.8, 0.38)] }, 10)
  assert.deepEqual(r.events, [])
})

test('one far-near-far hand cycle emits one clap; holding hands together does not', () => {
  const r = rig()
  for (const distance of [0.5, 0.45, 0.3, 0.13, 0.1, 0.2, 0.4]) r.step({ hands: pair(distance) })
  assert.deepEqual(r.events.map(e => e.type), ['clap'])
  r.hold({ hands: pair(0.1) }, 30)
  assert.equal(r.events.length, 1)
})

test('single hand or occlusion never substitutes a zero-distance clap', () => {
  const r = rig()
  r.hold({ hands: pair(0.5) }, 2)
  r.hold({ hands: [hand('Left', 0.5)] }, 2)
  r.hold({ hands: pair(0.5) }, 2)
  assert.deepEqual(r.events, [])
  r.step({ hands: pair(0.1) })
  r.step({ hands: [] })
  r.step({ hands: pair(0.5) })
  assert.deepEqual(r.events, [])
})

test('slow hand convergence times out and clap cooldown prevents a burst', () => {
  const r = rig()
  r.hold({ hands: pair(0.5) }, 2)
  r.hold({ hands: pair(0.25) }, 15)
  r.step({ hands: pair(0.1) })
  r.step({ hands: pair(0.5) })
  assert.deepEqual(r.events, [])
  const clap = () => { for (const d of [0.5, 0.28, 0.1, 0.16, 0.45]) r.step({ hands: pair(d) }) }
  clap(); clap()
  assert.equal(r.events.length, 1)
  r.hold({}, 20)
  clap()
  assert.equal(r.events.length, 2)
})

test('long sampling gaps and nonmonotonic timestamps cannot complete a pending gesture', () => {
  const r = rig()
  r.hold({ hands: [hand('Left', 0.2, 0.2)] }, 4)
  r.step({ hands: [hand('Left', 0.2, 0.2)] }, 2000)
  assert.deepEqual(r.events, [])
  assert.deepEqual(r.engine.process({ timestamp: 1, face: face(20), hands: [] }), [])
})

test('recalibration clears pending actions and learns a different neutral pitch', () => {
  const r = rig()
  r.step({ face: face(20) })
  r.engine.calibrate()
  assert.equal(r.engine.getState().calibrated, false)
  r.hold({ face: face(12) }, 14)
  assert.equal(r.engine.getState().calibrated, true)
  for (const p of [12, 29, 32, 22, 14, 12]) r.step({ face: face(p) })
  assert.deepEqual(r.events.map(e => e.type), ['nod'])
})

function landmarks(pitch = 0) {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  points[33] = { x: 0.4, y: 0.4, z: 0 }
  points[263] = { x: 0.6, y: 0.4, z: 0 }
  points[10] = { x: 0.5, y: 0.25, z: 0 }
  points[152] = { x: 0.5, y: 0.7, z: 0 }
  const angle = pitch * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle)
  return { faceLandmarks: [points], facialTransformationMatrixes: [{ rows: 4, columns: 4, data: [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, -40, 1] }] }
}

test('adapter reads column-major face rotation and corrects image aspect ratio', () => {
  const frame = landmarksToFrame(landmarks(18), { landmarks: [], handedness: [] }, 123, 640, 480)
  assert.ok(Math.abs(frame.face.pitch - 18) < 0.001)
  assert.ok(Math.abs(frame.face.raiseLine - 0.3) < 0.001)
  assert.equal(frame.timestamp, 123)
  assert.deepEqual(frame.hands, [])
  assert.equal(landmarksToFrame({}, {}, 124, 640, 480).face, null)
})

function controllerRig({ media, load } = {}) {
  let stopped = 0, closed = 0, requested = 0, loaded = 0, inference = 0, frameCallback
  const track = { stop: () => stopped++, addEventListener() {}, removeEventListener() {} }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
  const video = { srcObject: null, currentTime: 0, readyState: 4, videoWidth: 640, videoHeight: 480, play: async () => {}, pause() {} }
  const status = [], reactions = []
  const runtime = {
    mediaDevices: { getUserMedia: options => { requested++; assert.equal(options.audio, false); return media ? media(stream) : Promise.resolve(stream) } },
    loadModels: async () => { loaded++; if (load) return load(); return {
      face: { detectForVideo: () => { inference++; return landmarks() }, close: () => closed++ },
      hand: { detectForVideo: () => ({ landmarks: [], handedness: [] }), close: () => closed++ }, delegate: 'CPU',
    } },
    requestFrame: callback => { frameCallback = callback; return 1 },
    cancelFrame: () => { frameCallback = null },
    now: () => 0,
  }
  const controller = createCameraController({ onStatus: s => status.push(s), onReaction: e => reactions.push(e) }, runtime)
  return { controller, video, status, reactions, stream, tick: timestamp => { video.currentTime += 0.1; frameCallback?.(timestamp) }, repeat: timestamp => frameCallback?.(timestamp), counts: () => ({ stopped, closed, requested, loaded, inference }) }
}

test('camera resources load only on start, concurrent starts share one operation, and stop releases everything', async () => {
  const r = controllerRig()
  assert.equal(r.counts().loaded, 0)
  const first = r.controller.start(r.video), second = r.controller.start(r.video)
  assert.equal(first, second)
  assert.equal(await first, true)
  assert.equal(r.counts().requested, 1)
  assert.equal(r.counts().loaded, 1)
  assert.equal(r.controller.getState().state, 'calibrating')
  r.controller.stop()
  assert.equal(r.video.srcObject, null)
  assert.equal(r.counts().stopped, 1)
  assert.equal(r.counts().closed, 2)
  assert.equal(r.controller.getState().state, 'idle')
  r.controller.stop()
  assert.equal(r.counts().closed, 2)
})

test('stopping during permission request closes the eventual stream and never loads models', async () => {
  let finish
  const r = controllerRig({ media: stream => new Promise(resolve => { finish = () => resolve(stream) }) })
  const pending = r.controller.start(r.video)
  r.controller.stop()
  finish()
  assert.equal(await pending, false)
  assert.equal(r.counts().stopped, 1)
  assert.equal(r.counts().loaded, 0)
  assert.equal(r.controller.getState().state, 'idle')
})

test('models finishing after cancellation are closed and cannot restart frame processing', async () => {
  let finish, closed = 0
  const r = controllerRig({ load: () => new Promise(resolve => { finish = () => resolve({ face: { close: () => closed++ }, hand: { close: () => closed++ } }) }) })
  const pending = r.controller.start(r.video)
  for (let i = 0; i < 5; i++) await Promise.resolve()
  assert.equal(typeof finish, 'function')
  r.controller.stop()
  finish()
  assert.equal(await pending, false)
  assert.equal(closed, 2)
  assert.equal(r.counts().stopped, 1)
  assert.equal(r.controller.getState().state, 'idle')
})

test('permission denial has an actionable status and disposing prevents a new request', async () => {
  const r = controllerRig({ media: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) })
  assert.equal(await r.controller.start(r.video), false)
  assert.equal(r.controller.getState().state, 'error')
  assert.match(r.controller.getState().message, /权限|permission/i)
  r.controller.dispose()
  assert.equal(await r.controller.start(r.video), false)
  assert.equal(r.counts().requested, 1)
})

test('controller calibrates from fresh video frames and skips duplicate or too-fast frames', async () => {
  const r = controllerRig()
  await r.controller.start(r.video)
  r.tick(100)
  r.repeat(200)
  r.tick(120)
  assert.equal(r.counts().inference, 1)
  for (let timestamp = 200; timestamp <= 1600; timestamp += 100) r.tick(timestamp)
  assert.equal(r.controller.getState().state, 'running')
  assert.equal(r.controller.getState().metrics.facePresent, true)
  r.controller.calibrate()
  assert.equal(r.controller.getState().state, 'calibrating')
  r.controller.dispose()
})

test('a cancelled old start cannot detach the preview or overwrite the status of a new start', async () => {
  let finishOld, calls = 0, oldStopped = 0
  const oldStream = { getTracks: () => [{ stop: () => oldStopped++, removeEventListener() {} }] }
  const r = controllerRig({ media: stream => ++calls === 1 ? new Promise(resolve => { finishOld = () => resolve(oldStream) }) : Promise.resolve(stream) })
  const oldStart = r.controller.start(r.video)
  r.controller.stop()
  assert.equal(await r.controller.start(r.video), true)
  const newStream = r.video.srcObject
  finishOld()
  assert.equal(await oldStart, false)
  assert.equal(oldStopped, 1)
  assert.equal(r.video.srcObject, newStream)
  assert.equal(r.controller.getState().state, 'calibrating')
  r.controller.dispose()
})

test('model loading failure releases the preview stream and reports the local resource problem', async () => {
  const r = controllerRig({ load: () => Promise.reject(new Error('missing model')) })
  assert.equal(await r.controller.start(r.video), false)
  assert.equal(r.counts().stopped, 1)
  assert.equal(r.video.srcObject, null)
  assert.equal(r.controller.getState().state, 'error')
  assert.match(r.controller.getState().message, /models.*wasm/)
})

test('recognition borrows a meeting camera without recapturing or stopping its track', async () => {
  const r = controllerRig()
  assert.equal(await r.controller.start(r.video, { stream: r.stream }), true)
  assert.equal(r.counts().requested, 0)
  r.tick(100)
  r.controller.stop()
  assert.equal(r.counts().stopped, 0)
  assert.equal(r.video.srcObject, r.stream)
  assert.equal(r.counts().closed, 2)
})

test('borrowing an attached preview never resets srcObject and interrupts video.play', async () => {
  const r = controllerRig()
  let current = r.stream, assignments = 0
  Object.defineProperty(r.video, 'srcObject', { get: () => current, set: value => { current = value; assignments++ } })
  assert.equal(await r.controller.start(r.video, { stream: r.stream }), true)
  assert.equal(assignments, 0)
  r.controller.dispose()
})
