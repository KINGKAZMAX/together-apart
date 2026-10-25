import test from 'node:test'
import assert from 'node:assert/strict'
import { createMediaClient } from '../src/network/media-client.js'

class Track extends EventTarget {
  constructor(kind, label = kind) { super(); this.kind = kind; this.label = label; this.readyState = 'live'; this.enabled = true }
  stop() { this.readyState = 'ended' }
  clone() { return new Track(this.kind, `${this.label}-clone`) }
  end() { this.stop(); this.dispatchEvent(new Event('ended')) }
}
class Stream {
  constructor(tracks = []) { this.tracks = [...tracks] }
  getTracks() { return [...this.tracks] }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio') }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video') }
  addTrack(track) { if (!this.tracks.includes(track)) this.tracks.push(track) }
  removeTrack(track) { this.tracks = this.tracks.filter(t => t !== track) }
}
class Peer {
  constructor(configuration) {
    this.configuration = configuration; this.transceivers = []; this.candidates = []
    this.signalingState = 'stable'; this.connectionState = 'new'; this.localDescription = null; this.remoteDescription = null
  }
  addTransceiver(kind, options = {}) {
    const sender = { track: null, replaceTrack: async track => { sender.track = track } }
    const transceiver = { sender, kind, direction: options.direction || 'sendrecv', mid: null, receiver: { track: new Track(kind) } }; this.transceivers.push(transceiver); return transceiver
  }
  getTransceivers() { return this.transceivers }
  async setLocalDescription(description) {
    this.localDescription = description || { type: this.remoteDescription?.type === 'offer' && this.signalingState === 'have-remote-offer' ? 'answer' : 'offer', sdp: 'test-sdp' }
    this.signalingState = this.localDescription.type === 'offer' ? 'have-local-offer' : 'stable'
  }
  async setRemoteDescription(description) {
    this.remoteDescription = description; this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable'
    if (description.type === 'offer') {
      for (const [index, kind] of ['audio', 'video'].entries()) {
        if (this.transceivers.some(t => t.mid === String(index))) continue
        const transceiver = this.addTransceiver(kind, { direction: 'recvonly' })
        transceiver.mid = String(index)
      }
    }
  }
  async addIceCandidate(candidate) {
    if (!this.remoteDescription) throw new Error('Remote description required')
    this.candidates.push(candidate)
  }
  close() { this.connectionState = 'closed'; this.signalingState = 'closed' }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
function rig(options = {}) {
  const acquired = [], connections = [], signals = [], remoteStreams = [], states = []
  const devices = {
    getUserMedia: async constraints => {
      const stream = new Stream([new Track(constraints.audio ? 'audio' : 'video', constraints.audio ? 'mic' : 'camera')])
      acquired.push(stream); return stream
    },
    getDisplayMedia: async () => { const stream = new Stream([new Track('video', 'screen')]); acquired.push(stream); return stream },
    ...options.devices,
  }
  const client = createMediaClient({
    localId: options.localId || 'a', iceServers: [{ urls: 'stun:example.test' }],
    onSignal: (id, payload) => signals.push({ id, payload }),
    onStream: (id, stream) => remoteStreams.push({ id, stream }),
    onState: state => states.push(state),
  }, { RTCPeerConnection: class extends Peer { constructor(config) { super(config); connections.push(this) } }, MediaStream: Stream, mediaDevices: devices })
  return { client, acquired, connections, signals, remoteStreams, states }
}

test('joining negotiates a receiver without ever requesting camera or microphone', async () => {
  const r = rig(); r.client.setPeers([{ id: 'a' }, { id: 'b' }]); await tick()
  assert.equal(r.acquired.length, 0)
  assert.equal(r.connections.length, 1)
  assert.deepEqual(r.connections[0].transceivers.map(t => t.kind), ['audio', 'video'])
  assert.equal(r.signals.filter(s => s.payload.description?.type === 'offer').length, 1)
  assert.equal(r.client.getState().camera, false)
  assert.equal(r.client.getState().microphone, false)
  r.client.dispose()
})

test('only the ordered initiator offers, and an early ICE candidate waits for its SDP', async () => {
  const r = rig({ localId: 'z' }); r.client.setPeers([{ id: 'a' }]); await tick()
  assert.equal(r.signals.length, 0)
  const candidate = { candidate: 'test-candidate', sdpMid: '0' }
  await r.client.receiveSignal('a', { candidate })
  assert.equal(r.connections[0].candidates.length, 0)
  await r.client.receiveSignal('a', { description: { type: 'offer', sdp: 'test' } })
  assert.deepEqual(r.connections[0].candidates, [candidate])
  assert.equal(r.signals.at(-1).payload.description.type, 'answer')
  r.client.dispose()
})

test('canceling a permission request stops the eventual stream and never turns the microphone on', async () => {
  let resolvePermission
  const stream = new Stream([new Track('audio')])
  const r = rig({ devices: { getUserMedia: () => new Promise(resolve => { resolvePermission = resolve }) } })
  const pending = r.client.enableMicrophone(true)
  assert.equal(r.client.getState().busy.microphone, true)
  await r.client.enableMicrophone(false)
  resolvePermission(stream)
  assert.equal(await pending, false)
  assert.equal(stream.getAudioTracks()[0].readyState, 'ended')
  assert.equal(r.client.getState().microphone, false)
  r.client.dispose()
})

test('screen sharing changes only the video sender, and browser stop restores the camera', async () => {
  const r = rig(); r.client.setPeers([{ id: 'b' }]); await tick()
  assert.equal(await r.client.enableMicrophone(true), true)
  assert.equal(await r.client.enableCamera(true), true)
  const pc = r.connections[0], mic = pc.transceivers[0].sender.track, camera = pc.transceivers[1].sender.track
  assert.equal(r.client.getState().cameraStream.getVideoTracks()[0], camera)
  assert.equal(await r.client.enableScreenShare(true), true)
  const screen = pc.transceivers[1].sender.track
  assert.equal(screen.label, 'screen'); assert.equal(pc.transceivers[0].sender.track, mic)
  assert.equal(camera.readyState, 'live')
  screen.end(); await tick()
  assert.equal(pc.transceivers[1].sender.track, camera)
  assert.equal(r.client.getState().screen, false)
  assert.equal(r.client.getState().videoSource, 'camera')
  r.client.dispose()
})

test('turning camera off during sharing preserves microphone and shared screen', async () => {
  const r = rig(); r.client.setPeers([{ id: 'b' }]); await tick()
  await r.client.enableMicrophone(true); await r.client.enableCamera(true); await r.client.enableScreenShare(true)
  const camera = r.client.getState().cameraStream.getVideoTracks()[0]
  await r.client.enableCamera(false)
  assert.equal(camera.readyState, 'ended')
  assert.equal(r.connections[0].transceivers[0].sender.track.label, 'mic')
  assert.equal(r.connections[0].transceivers[1].sender.track.label, 'screen')
  await r.client.enableScreenShare(false)
  assert.equal(r.connections[0].transceivers[1].sender.track, null)
  r.client.dispose()
})

test('a denied permission produces an actionable error and permits a successful retry', async () => {
  let denied = true
  const r = rig({ devices: { getUserMedia: async () => { if (denied) throw new DOMException('Denied', 'NotAllowedError'); return new Stream([new Track('video')]) } } })
  assert.equal(await r.client.enableCamera(true), false)
  assert.match(r.client.getState().error, /permission/i)
  assert.equal(r.client.getState().busy.camera, false)
  denied = false
  assert.equal(await r.client.enableCamera(true), true)
  assert.equal(r.client.getState().error, null)
  r.client.dispose()
})

test('removing a peer closes its connection and clears the remote stream', async () => {
  const r = rig(); r.client.setPeers([{ id: 'b' }, { id: 'c' }]); await tick()
  const remote = new Stream([new Track('audio')])
  r.connections[0].ontrack({ track: remote.getAudioTracks()[0], streams: [remote] })
  assert.equal(r.remoteStreams.at(-1).id, 'b')
  r.client.setPeers([{ id: 'c' }])
  assert.equal(r.connections[0].connectionState, 'closed')
  assert.deepEqual(r.remoteStreams.at(-1), { id: 'b', stream: null })
  r.client.dispose()
})

test('dispose owns acquired media and external clones, but never stops the supplied camera stream', async () => {
  const r = rig(); const original = new Track('video', 'external')
  await r.client.setCameraStream(new Stream([original])); await r.client.enableCamera(true); await r.client.enableMicrophone(true)
  assert.equal(r.acquired.length, 1, 'external camera avoids a second camera permission request')
  const outgoingCamera = r.client.getState().localStream.getVideoTracks()[0]
  assert.notEqual(outgoingCamera, original)
  r.client.dispose()
  assert.equal(original.readyState, 'live')
  assert.equal(outgoingCamera.readyState, 'ended')
  assert.equal(r.acquired[0].getTracks()[0].readyState, 'ended')
  assert.equal(r.client.getState().camera, false)
})

test('dispose while permission is pending cannot leak a late camera stream', async () => {
  let grant
  const stream = new Stream([new Track('video')])
  const r = rig({ devices: { getUserMedia: () => new Promise(resolve => { grant = resolve }) } })
  const request = r.client.enableCamera(true); r.client.dispose(); grant(stream)
  assert.equal(await request, false)
  assert.equal(stream.getTracks()[0].readyState, 'ended')
})

test('a full offer and answer exchange reaches stable signaling for both peers', async () => {
  const caller = rig({ localId: 'a' }), callee = rig({ localId: 'b' })
  caller.client.setPeers([{ id: 'b' }]); callee.client.setPeers([{ id: 'a' }]); await tick()
  await callee.client.receiveSignal('a', caller.signals[0].payload)
  await caller.client.receiveSignal('b', callee.signals[0].payload)
  assert.equal(caller.connections[0].signalingState, 'stable')
  assert.equal(callee.connections[0].signalingState, 'stable')
  await caller.client.enableCamera(true)
  assert.equal(caller.signals.length, 1, 'enabling camera reuses the negotiated sender')
  caller.client.dispose(); callee.client.dispose()
})

test('disposal suppresses late offers and all subsequent capture requests', async () => {
  const r = rig(); r.client.setPeers([{ id: 'b' }]); r.client.dispose(); await tick()
  assert.equal(r.signals.length, 0)
  assert.equal(await r.client.enableCamera(true), false)
  assert.equal(await r.client.enableMicrophone(true), false)
  assert.equal(await r.client.enableScreenShare(true), false)
  assert.equal(r.acquired.length, 0)
  assert.equal(r.connections[0].connectionState, 'closed')
})

test('a second enable request cancels an older permission result instead of retaining two cameras', async () => {
  const grants = []
  const r = rig({ devices: { getUserMedia: () => new Promise(resolve => grants.push(resolve)) } })
  const first = r.client.enableCamera(true), second = r.client.enableCamera(true)
  const stale = new Stream([new Track('video', 'stale')]), current = new Stream([new Track('video', 'current')])
  grants[1](current); assert.equal(await second, true)
  grants[0](stale); assert.equal(await first, false)
  assert.equal(stale.getVideoTracks()[0].readyState, 'ended')
  assert.equal(r.client.getState().cameraStream, current)
  assert.equal(current.getVideoTracks()[0].readyState, 'live')
  r.client.dispose()
})

test('gesture-only capture stays local, then explicit camera sharing reuses that stream before off stops it', async () => {
  const r = rig(); r.client.setPeers([{ id: 'b' }]); await tick()
  assert.equal(await r.client.enableCamera(true, { broadcast: false }), true)
  const captured = r.client.getState().cameraStream
  assert.equal(r.client.getState().cameraCaptured, true)
  assert.equal(r.client.getState().camera, false)
  assert.equal(r.client.getState().videoSource, null)
  assert.equal(r.client.getState().localStream.getVideoTracks().length, 0)
  assert.equal(r.connections[0].transceivers[1].sender.track, null)
  await r.client.enableCamera(true)
  assert.equal(r.acquired.length, 1, 'sharing reuses gesture capture instead of requesting a second camera')
  assert.equal(r.client.getState().cameraStream, captured)
  assert.equal(r.client.getState().camera, true)
  assert.equal(r.connections[0].transceivers[1].sender.track, captured.getVideoTracks()[0])
  await r.client.enableCamera(false)
  assert.equal(r.client.getState().cameraCaptured, false)
  assert.equal(r.client.getState().camera, false)
  assert.equal(captured.getVideoTracks()[0].readyState, 'ended')
  assert.equal(r.connections[0].transceivers[1].sender.track, null)
  r.client.dispose()
})

test('peers joining after gesture-only capture receive no camera track', async () => {
  const r = rig(); await r.client.enableCamera(true, { broadcast: false })
  r.client.setPeers([{ id: 'b' }]); await tick()
  assert.equal(r.connections[0].transceivers[1].sender.track, null)
  assert.equal(r.client.getState().cameraCaptured, true)
  assert.equal(r.client.getState().camera, false)
  r.client.dispose()
})

test('screen sharing during local gesture capture never restores an unshared camera', async () => {
  const r = rig(); r.client.setPeers([{ id: 'b' }]); await tick()
  await r.client.enableMicrophone(true)
  await r.client.enableCamera(true, { broadcast: false })
  const captured = r.client.getState().cameraStream
  await r.client.enableScreenShare(true)
  assert.equal(r.client.getState().videoSource, 'screen')
  assert.equal(r.connections[0].transceivers[1].sender.track.label, 'screen')
  await r.client.enableScreenShare(false)
  assert.equal(r.connections[0].transceivers[1].sender.track, null)
  assert.equal(r.connections[0].transceivers[0].sender.track.label, 'mic')
  assert.equal(captured.getVideoTracks()[0].readyState, 'live')
  assert.equal(r.client.getState().cameraCaptured, true)
  assert.equal(r.client.getState().camera, false)
  r.client.dispose()
})

test('the answerer sends using the offer-created transceivers rather than unnegotiated duplicates', async () => {
  const r = rig({ localId: 'z' }); r.client.setPeers([{ id: 'a' }]); await tick()
  await r.client.enableCamera(true); await r.client.enableMicrophone(true)
  await r.client.receiveSignal('a', { description: { type: 'offer', sdp: 'test' } })
  const transceivers = r.connections[0].getTransceivers()
  assert.equal(transceivers.length, 2, 'answerer must not create a second unnegotiated audio/video pair')
  assert.ok(transceivers.every(t => t.direction === 'sendrecv' && t.mid !== null))
  assert.equal(transceivers.find(t => t.receiver.track.kind === 'audio').sender.track.label, 'mic')
  assert.equal(transceivers.find(t => t.receiver.track.kind === 'video').sender.track.label, 'camera')
  r.client.dispose()
})
