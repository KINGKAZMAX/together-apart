import { useCallback, useEffect, useRef, useState } from 'react'
import { createWorkshopScene } from './scene/WorkshopScene.js'
import { createCameraController } from './vision/camera-controller.js'
import { createMeetingClient } from './network/meeting-client.js'
import { createMediaClient } from './network/media-client.js'

const EMPTY_MEDIA = { microphone: false, camera: false, screen: false, busy: {}, error: null, cameraStream: null, peers: [] }
const EMPTY_ROOM = { status: 'idle', selfId: null, roomId: null, participants: [], messages: [], error: null }
export default function useWorkspace({ name, avatar, locale }) {
  const container = useRef(null), video = useRef(null), scene = useRef(null), camera = useRef(null), network = useRef(null), media = useRef(null)
  const gestureOperation = useRef(0), serial = useRef(0), configReady = useRef(Promise.resolve())
  const [ready, setReady] = useState(false), [sceneError, setSceneError] = useState(false)
  const [room, setRoom] = useState(EMPTY_ROOM), [mediaState, setMediaState] = useState(EMPTY_MEDIA)
  const [vision, setVision] = useState({ state: 'idle', message: '', metrics: {} })
  const [streams, setStreams] = useState({}), [events, setEvents] = useState([])
  const [viewMode, setViewMode] = useState('follow')
  const react = useCallback((type, source = 'manual') => {
    if (!['nod', 'clap', 'raise'].includes(type) || !scene.current) return
    scene.current.react(type, { source })
    network.current?.react(type, { source })
    setEvents(previous => [{ id: ++serial.current, type, source, local: true, at: Date.now() }, ...previous].slice(0, 8))
  }, [])
  useEffect(() => {
    let active = true, mediaId = 'preview', config = { iceServers: [] }, previousRoom = null, sentMedia = '', lastPeers = ''
    const initializeMedia = localId => {
      gestureOperation.current++
      camera.current?.stop()
      media.current?.dispose()
      mediaId = localId
      sentMedia = ''; lastPeers = ''
      setStreams({}); setMediaState(EMPTY_MEDIA)
      media.current = createMediaClient({ localId, iceServers: config.iceServers,
        onState: state => {
          if (!active) return
          setMediaState(state)
          if (!state.cameraCaptured && !['idle', 'error'].includes(camera.current?.getState().state)) { gestureOperation.current++; camera.current?.stop() }
          const flags = { audio: state.microphone, video: state.camera, screen: state.screen }
          const signature = JSON.stringify(flags)
          if (signature !== sentMedia) { sentMedia = signature; network.current?.setMedia(flags) }
        },
        onStream: (id, stream) => { if (active) setStreams(previous => { const next = { ...previous }; if (stream) next[id] = stream; else delete next[id]; return next }) },
        onSignal: (id, data) => network.current?.sendSignal(id, data),
      })
    }
    try {
      scene.current = createWorkshopScene(container.current, {
        onReady: () => { if (active) setReady(true) },
        onMove: pose => network.current?.sendPose(pose),
      })
    } catch { queueMicrotask(() => { if (active) setSceneError(true) }) }
    camera.current = createCameraController({ onReaction: event => react(event.type, 'camera'), onStatus: state => { if (active) setVision(state) } })
    network.current = createMeetingClient({
      onState: state => {
        if (!active) return
        setRoom(state)
        if (state.status === 'joined') {
          if (mediaId !== state.selfId) initializeMedia(state.selfId)
          scene.current?.setParticipants(state.participants, state.selfId)
          const peers = state.participants.filter(p => p.id !== state.selfId)
          const signature = peers.map(p => p.id).sort().join(',')
          if (signature !== lastPeers) { lastPeers = signature; media.current?.setPeers(peers) }
          if (previousRoom !== state.roomId) {
            previousRoom = state.roomId
            const url = new URL(location.href); url.searchParams.set('room', state.roomId); history.replaceState(null, '', url)
            const player = scene.current?.getState().player
            if (player) network.current?.sendPose(player)
          }
        } else if (previousRoom) {
          previousRoom = null
          scene.current?.setMeetingMode(false)
          initializeMedia('preview')
          const url = new URL(location.href); url.searchParams.delete('room'); history.replaceState(null, '', url)
        }
      },
      onEvent: event => {
        if (!active) return
        if (event.type === 'pose') scene.current?.updateRemotePose(event.participantId, event.pose)
        if (event.type === 'reaction') {
          const current = network.current?.getState()
          if (event.participantId === current?.selfId) return
          scene.current?.reactRemote(event.participantId, event.reaction, { source: event.source })
          const who = current?.participants.find(p => p.id === event.participantId)
          setEvents(previous => [{ id: ++serial.current, type: event.reaction, source: event.source, name: who?.name || '', local: false, at: Date.now() }, ...previous].slice(0, 8))
        }
        if (event.type === 'signal') media.current?.receiveSignal(event.from, event.data)
      },
    })
    // Defer initialization so effect setup never synchronously updates React state.
    queueMicrotask(() => { if (active) initializeMedia('preview') })
    configReady.current = fetch('/api/config').then(response => { if (!response.ok) throw new Error('config'); return response.json() }).then(value => { if (active) config = value }).catch(() => {})
    window.render_game_to_text = () => {
      const state = network.current?.getState() || EMPTY_ROOM, m = media.current?.getState() || EMPTY_MEDIA
      return JSON.stringify({ mode: state.status === 'joined' ? 'meeting' : 'preview', language: document.documentElement.lang,
        ...scene.current?.getState(), room: { status: state.status, id: state.roomId, selfId: state.selfId, participants: state.participants, messages: state.messages },
        camera: camera.current?.getState(), media: { microphone: m.microphone, camera: m.camera, cameraCaptured: m.cameraCaptured, screen: m.screen, peers: m.peers },
      })
    }
    window.advanceTime = ms => { const count = Math.max(1, Math.ceil(ms / (1000 / 60))); for (let i = 0; i < count; i++) scene.current?.update(ms / count / 1000); scene.current?.render() }
    return () => {
      active = false
      camera.current?.dispose(); media.current?.dispose(); network.current?.dispose(); scene.current?.dispose()
      camera.current = null; media.current = null; network.current = null; scene.current = null
      delete window.render_game_to_text; delete window.advanceTime
    }
  }, [react])
  useEffect(() => { scene.current?.setName(name.trim() || 'Alex'); network.current?.setName(name.trim() || 'Alex') }, [name])
  useEffect(() => { scene.current?.setAvatar(avatar); network.current?.setAvatar(avatar) }, [avatar])
  useEffect(() => { scene.current?.setLanguage(locale) }, [locale])
  useEffect(() => {
    const element = video.current
    if (!element) return
    if (element.srcObject !== (mediaState.cameraStream || null)) element.srcObject = mediaState.cameraStream || null
    if (mediaState.cameraStream) element.play().catch(() => {})
  }, [mediaState.cameraStream])

  async function connect(kind, code) {
    await configReady.current
    let roomId = String(code || '').trim()
    if (roomId.includes('?')) { try { roomId = new URL(roomId, location.origin).searchParams.get('room') || roomId } catch { /* The server will reject invalid codes. */ } }
    return kind === 'create' ? network.current.createRoom({ name: name.trim(), avatar }) : network.current.joinRoom(roomId, { name: name.trim(), avatar })
  }
  async function toggleCamera() {
    if (media.current?.getState().camera) { gestureOperation.current++; camera.current?.stop(); return media.current.enableCamera(false) }
    const operation = ++gestureOperation.current
    const success = await media.current?.enableCamera(true)
    if (success && operation === gestureOperation.current) await camera.current?.start(video.current, { stream: media.current.getState().cameraStream })
    return success
  }
  async function toggleGestures() {
    const state = camera.current?.getState().state
    if (state && !['idle', 'error'].includes(state)) { gestureOperation.current++; camera.current.stop(); if (!media.current?.getState().camera) await media.current?.enableCamera(false); return }
    const operation = ++gestureOperation.current
    if (!media.current?.getState().cameraCaptured && !await media.current?.enableCamera(true, { broadcast: false })) return
    if (operation !== gestureOperation.current) return
    const stream = media.current.getState().cameraStream
    if (stream) await camera.current?.start(video.current, { stream })
  }
  function leave() { gestureOperation.current++; camera.current?.stop(); network.current?.leave(); setEvents([]) }
  function focus() { scene.current?.focusLocalPlayer(); setViewMode('follow') }
  function overview() { scene.current?.setViewMode('room'); setViewMode('room') }
  return { container, video, ready, sceneError, room, mediaState, vision, streams, events, viewMode, react, connect, leave, toggleCamera, toggleGestures, focus, overview,
    zoom: delta => scene.current?.zoomBy(delta),
    calibrate: () => camera.current?.calibrate(),
    toggleMic: () => media.current?.enableMicrophone(!media.current?.getState().microphone),
    toggleShare: () => media.current?.enableScreenShare(!media.current?.getState().screen),
    sendChat: text => network.current?.sendChat(text),
  }
}
