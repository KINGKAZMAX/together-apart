const liveTrack = (stream, kind) => stream?.getTracks().find(track => track.kind === kind && track.readyState !== 'ended') || null
const stopStream = stream => stream?.getTracks().forEach(track => track.stop())

function permissionMessage(error, device) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return `${device} permission was not granted. Allow access in your browser, then try again.`
  if (error?.name === 'NotFoundError') return `No ${device.toLowerCase()} was found. Connect a device, then try again.`
  if (error?.name === 'NotReadableError') return `${device} is unavailable or in use by another app. Close that app, then try again.`
  return `${device} could not start. Check your device and browser permissions, then try again.`
}

/** A small room uses one encrypted WebRTC connection per remote participant.
 * Signaling is delegated to the room transport. Media is always opt-in.
 */
export function createMediaClient({ localId, onState = () => {}, onStream = () => {}, onSignal = () => {}, iceServers = [] }, runtime = {}) {
  const PeerConnection = runtime.RTCPeerConnection || globalThis.RTCPeerConnection
  const MediaStreamType = runtime.MediaStream || globalThis.MediaStream
  const devices = runtime.mediaDevices || globalThis.navigator?.mediaDevices
  const peers = new Map()
  const localStream = new MediaStreamType()
  const busy = { microphone: false, camera: false, screen: false }
  const revision = { microphone: 0, camera: 0, screen: 0 }
  let disposed = false, error = null
  let microphoneStream = null, cameraStream = null, screenStream = null
  let suppliedCameraStream = null, cameraClone = null, broadcastCamera = false

  const audioTrack = () => liveTrack(microphoneStream, 'audio')
  const cameraTrack = () => cameraClone ? (cameraClone.readyState !== 'ended' ? cameraClone : null) : liveTrack(cameraStream, 'video')
  const sentCameraTrack = () => broadcastCamera ? cameraTrack() : null
  const videoTrack = () => liveTrack(screenStream, 'video') || sentCameraTrack()
  const getState = () => ({
    microphone: Boolean(audioTrack()), camera: Boolean(sentCameraTrack()), cameraCaptured: Boolean(cameraTrack()), screen: Boolean(liveTrack(screenStream, 'video')),
    busy: { ...busy }, error, localStream, cameraStream, screenStream,
    videoSource: liveTrack(screenStream, 'video') ? 'screen' : sentCameraTrack() ? 'camera' : null,
    peers: [...peers.values()].map(peer => ({ id: peer.id, connectionState: peer.pc.connectionState })),
  })
  const emit = () => { if (!disposed) onState(getState()) }
  const report = message => { if (!disposed) { error = message; emit() } }
  const active = peer => !disposed && peers.get(peer.id) === peer && peer.pc.signalingState !== 'closed'
  const signal = (peer, payload) => { if (active(peer)) onSignal(peer.id, payload) }

  function syncLocalStream() {
    const selected = [audioTrack(), videoTrack()].filter(Boolean)
    for (const track of localStream.getTracks()) if (!selected.includes(track)) localStream.removeTrack(track)
    for (const track of selected) if (!localStream.getTracks().includes(track)) localStream.addTrack(track)
  }

  function syncPeer(peer) {
    // Serialize replacements so a late permission result cannot undo a newer mute.
    peer.trackQueue = peer.trackQueue.catch(() => {}).then(async () => {
      if (!active(peer)) return
      await peer.audio?.replaceTrack(audioTrack())
      if (!active(peer)) return
      await peer.video?.replaceTrack(videoTrack())
    })
    return peer.trackQueue
  }

  async function syncTracks() {
    syncLocalStream()
    await Promise.all([...peers.values()].map(peer => syncPeer(peer).catch(() => {
      if (active(peer)) report('A media connection could not update. Leave and rejoin the room to reconnect.')
    })))
  }

  async function negotiate(peer) {
    if (!active(peer) || peer.makingOffer || peer.pc.signalingState !== 'stable') return
    try {
      peer.makingOffer = true
      await peer.pc.setLocalDescription()
      signal(peer, { description: { type: peer.pc.localDescription.type, sdp: peer.pc.localDescription.sdp } })
    } catch {
      if (active(peer)) report('The call could not connect. Leave and rejoin the room to retry.')
    } finally { peer.makingOffer = false }
  }

  function removePeer(peer) {
    peers.delete(peer.id)
    peer.pc.onicecandidate = peer.pc.ontrack = peer.pc.onconnectionstatechange = peer.pc.onnegotiationneeded = null
    peer.pc.close()
    onStream(peer.id, null)
  }

  function ensurePeer(id) {
    if (disposed || !id || id === localId) return null
    if (peers.has(id)) return peers.get(id)
    if (!PeerConnection) { report('This browser does not support calls. Open this room in a current Chrome, Edge, Firefox, or Safari browser.'); return null }
    const pc = new PeerConnection({ iceServers })
    const peer = {
      id, pc, polite: String(localId) > String(id), makingOffer: false, ignoreOffer: false, settingAnswer: false,
      pendingCandidates: [], signalQueue: Promise.resolve(), trackQueue: Promise.resolve(), remoteStream: new MediaStreamType(),
    }
    peers.set(id, peer)
    // Only the offerer creates transceivers. The answerer must adopt those
    // created by setRemoteDescription; pre-creating both sides would leave
    // duplicate, unnegotiated senders on the answerer and produce one-way media.
    if (!peer.polite) {
      peer.audio = pc.addTransceiver('audio', { direction: 'sendrecv', streams: [localStream] }).sender
      peer.video = pc.addTransceiver('video', { direction: 'sendrecv', streams: [localStream] }).sender
    }
    pc.onicecandidate = event => { if (event.candidate) signal(peer, { candidate: event.candidate.toJSON?.() || event.candidate }) }
    pc.ontrack = event => {
      if (!active(peer)) return
      if (!peer.remoteStream.getTracks().includes(event.track)) peer.remoteStream.addTrack(event.track)
      onStream(id, peer.remoteStream)
      event.track.addEventListener?.('ended', () => {
        if (!active(peer)) return
        peer.remoteStream.removeTrack(event.track)
        onStream(id, peer.remoteStream)
      }, { once: true })
    }
    pc.onconnectionstatechange = () => {
      if (!active(peer)) return
      if (pc.connectionState === 'failed') report('A participant’s audio/video connection failed. Leave and rejoin to retry; some networks require a TURN relay.')
      emit()
    }
    // Exactly one participant initiates; perfect negotiation below also handles
    // a future incoming offer during renegotiation without offer glare.
    syncPeer(peer).then(() => { if (!peer.polite) return negotiate(peer) }).catch(() => report('The call could not initialize. Please rejoin the room.'))
    return peer
  }

  function setPeers(participants) {
    if (disposed) return
    const ids = new Set(participants.map(participant => participant.id).filter(id => id && id !== localId))
    for (const peer of peers.values()) if (!ids.has(peer.id)) removePeer(peer)
    for (const id of ids) ensurePeer(id)
    emit()
  }

  async function receiveSignal(from, payload) {
    const peer = ensurePeer(from)
    if (!peer || !payload) return
    peer.signalQueue = peer.signalQueue.catch(() => {}).then(async () => {
      if (!active(peer)) return
      const { description, candidate } = payload
      if (description) {
        if (!['offer', 'answer'].includes(description.type) || typeof description.sdp !== 'string') return
        const readyForOffer = !peer.makingOffer && (peer.pc.signalingState === 'stable' || peer.settingAnswer)
        const collision = description.type === 'offer' && !readyForOffer
        peer.ignoreOffer = !peer.polite && collision
        if (peer.ignoreOffer) return
        peer.settingAnswer = description.type === 'answer'
        try { await peer.pc.setRemoteDescription(description) } finally { peer.settingAnswer = false }
        if (!active(peer)) return
        for (const queued of peer.pendingCandidates.splice(0)) await peer.pc.addIceCandidate(queued)
        if (description.type === 'offer') {
          for (const transceiver of peer.pc.getTransceivers()) {
            if (transceiver.mid === null) continue
            const kind = transceiver.receiver.track.kind
            if (kind !== 'audio' && kind !== 'video') continue
            transceiver.direction = 'sendrecv'
            transceiver.sender.setStreams?.(localStream)
            peer[kind] = transceiver.sender
          }
          await syncPeer(peer)
          if (!active(peer)) return
          await peer.pc.setLocalDescription()
          signal(peer, { description: { type: peer.pc.localDescription.type, sdp: peer.pc.localDescription.sdp } })
        }
      } else if (candidate && !peer.ignoreOffer) {
        if (!peer.pc.remoteDescription) peer.pendingCandidates.push(candidate)
        else await peer.pc.addIceCandidate(candidate)
      }
    }).catch(() => {
      if (active(peer) && !peer.ignoreOffer) report('A participant could not connect. Leave and rejoin the room to retry.')
    })
    return peer.signalQueue
  }

  function clearCamera() {
    cameraClone?.stop(); cameraClone = null
    if (cameraStream !== suppliedCameraStream) stopStream(cameraStream)
    cameraStream = null; broadcastCamera = false
  }

  async function enableMicrophone(enabled) {
    if (disposed) return false
    const request = ++revision.microphone
    error = null
    if (!enabled) {
      busy.microphone = false; stopStream(microphoneStream); microphoneStream = null
      await syncTracks(); emit(); return true
    }
    if (audioTrack()) { busy.microphone = false; emit(); return true }
    busy.microphone = true; emit()
    try {
      if (!devices?.getUserMedia) throw new Error('Media capture unavailable')
      const stream = await devices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
      if (disposed || request !== revision.microphone) { stopStream(stream); return false }
      if (!liveTrack(stream, 'audio')) { stopStream(stream); throw new Error('No microphone track') }
      microphoneStream = stream
      liveTrack(stream, 'audio').addEventListener?.('ended', () => { if (!disposed && microphoneStream === stream) void enableMicrophone(false) }, { once: true })
      busy.microphone = false; await syncTracks(); emit(); return true
    } catch (cause) {
      if (disposed || request !== revision.microphone) return false
      busy.microphone = false; report(permissionMessage(cause, 'Microphone')); return false
    }
  }

  // Gesture recognition may borrow cameraStream while broadcast is false.
  // Only an explicit broadcast=true call attaches this capture to peer senders.
  async function enableCamera(enabled, { broadcast = true } = {}) {
    if (disposed) return false
    const request = ++revision.camera
    error = null
    if (!enabled) {
      busy.camera = false; clearCamera(); await syncTracks(); emit(); return true
    }
    if (cameraTrack()) {
      broadcastCamera = Boolean(broadcast)
      busy.camera = false; await syncTracks(); emit(); return true
    }
    busy.camera = true; emit()
    try {
      const suppliedTrack = liveTrack(suppliedCameraStream, 'video')
      if (suppliedTrack) {
        cameraStream = suppliedCameraStream; cameraClone = suppliedTrack.clone()
      } else {
        if (!devices?.getUserMedia) throw new Error('Media capture unavailable')
        const stream = await devices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 20, max: 30 }, facingMode: 'user' } })
        if (disposed || request !== revision.camera) { stopStream(stream); return false }
        if (!liveTrack(stream, 'video')) { stopStream(stream); throw new Error('No camera track') }
        cameraStream = stream
      }
      const selectedStream = cameraStream
      cameraTrack().addEventListener?.('ended', () => { if (!disposed && cameraStream === selectedStream) void enableCamera(false) }, { once: true })
      broadcastCamera = Boolean(broadcast)
      busy.camera = false; await syncTracks(); emit(); return true
    } catch (cause) {
      if (disposed || request !== revision.camera) return false
      busy.camera = false; report(permissionMessage(cause, 'Camera')); return false
    }
  }

  async function setCameraStream(stream) {
    if (disposed) return false
    const wasCaptured = Boolean(cameraTrack()), wasBroadcasting = broadcastCamera
    ++revision.camera; busy.camera = false; clearCamera(); suppliedCameraStream = stream
    if (wasCaptured && liveTrack(stream, 'video')) return enableCamera(true, { broadcast: wasBroadcasting })
    await syncTracks(); emit(); return true
  }

  async function enableScreenShare(enabled) {
    if (disposed) return false
    const request = ++revision.screen
    error = null
    if (!enabled) {
      busy.screen = false; stopStream(screenStream); screenStream = null
      await syncTracks(); emit(); return true
    }
    if (liveTrack(screenStream, 'video')) { busy.screen = false; emit(); return true }
    busy.screen = true; emit()
    try {
      if (!devices?.getDisplayMedia) throw new Error('Screen sharing unavailable')
      const stream = await devices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false })
      if (disposed || request !== revision.screen) { stopStream(stream); return false }
      const track = liveTrack(stream, 'video')
      if (!track) { stopStream(stream); throw new Error('No shared screen track') }
      screenStream = stream
      track.addEventListener?.('ended', () => { if (!disposed && screenStream === stream) void enableScreenShare(false) }, { once: true })
      busy.screen = false; await syncTracks(); emit(); return true
    } catch (cause) {
      if (disposed || request !== revision.screen) return false
      busy.screen = false; report(permissionMessage(cause, 'Screen sharing')); return false
    }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    for (const kind of Object.keys(revision)) { revision[kind]++; busy[kind] = false }
    for (const peer of [...peers.values()]) removePeer(peer)
    stopStream(microphoneStream); microphoneStream = null
    stopStream(screenStream); screenStream = null
    clearCamera(); suppliedCameraStream = null
    syncLocalStream()
  }

  return { setPeers, receiveSignal, enableMicrophone, enableCamera, enableScreenShare, setCameraStream, getState, dispose }
}
