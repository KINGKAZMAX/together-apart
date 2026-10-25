const initialState = () => ({ status: 'idle', selfId: null, roomId: null, participants: [], messages: [], error: null })
const connectionError = (code, message) => Object.assign(new Error(message), { code })

/** A single explicit room session. Disconnecting never silently rejoins a meeting. */
export function createMeetingClient({ onState = () => {}, onEvent = () => {}, url, WebSocket: Socket = globalThis.WebSocket } = {}) {
  let state = initialState()
  let socket = null
  let connectPromise = null
  let cancelConnect = null
  let epoch = 0
  let sequence = 0
  let disposed = false
  let lastPoseAt = 0
  let joinPending = false
  const pending = new Map()
  const getState = () => ({ ...state, participants: state.participants.map(participant => ({ ...participant, pose: { ...participant.pose }, media: { ...participant.media } })), messages: state.messages.map(message => ({ ...message })), error: state.error && { ...state.error } })
  const publish = () => { if (!disposed) onState(getState()) }
  const failPending = error => {
    pending.forEach(request => { clearTimeout(request.timer); request.reject(error) })
    pending.clear()
  }
  const updatePose = (id, pose) => { state.participants = state.participants.map(participant => participant.id === id ? { ...participant, pose: { ...pose } } : participant) }
  function receive(raw) {
    let message
    try { message = JSON.parse(raw) } catch { return }
    if (!message || typeof message !== 'object') return
    switch (message.type) {
      case 'joined': {
        state = { status: 'joined', selfId: message.selfId, roomId: message.roomId, participants: message.participants, messages: message.messages || [], error: null }
        const request = pending.get(message.requestId)
        if (request) { clearTimeout(request.timer); pending.delete(message.requestId); request.resolve(getState()) }
        publish()
        break
      }
      case 'participants': state.participants = message.participants; publish(); break
      case 'pose': updatePose(message.participantId, message.pose); break
      case 'chat': state.messages = [...state.messages, message.message].slice(-50); publish(); break
      case 'left': state = initialState(); publish(); break
      case 'error': {
        const error = connectionError(message.code || 'SERVER_ERROR', message.message || 'The meeting could not be updated.')
        const request = pending.get(message.requestId)
        if (request) { clearTimeout(request.timer); pending.delete(message.requestId); request.reject(error) }
        state.error = { code: error.code, message: error.message }
        if (state.status !== 'joined') state.status = 'error'
        publish()
        break
      }
    }
    if (!disposed) onEvent(message)
  }
  function connect() {
    if (disposed) return Promise.reject(connectionError('DISPOSED', 'The meeting client is closed.'))
    if (socket?.readyState === 1) return Promise.resolve()
    if (connectPromise) return connectPromise
    const version = ++epoch
    state = { ...initialState(), status: 'connecting' }
    publish()
    let endpoint = url
    if (!endpoint) {
      const location = globalThis.location
      endpoint = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/socket`
    }
    connectPromise = new Promise((resolve, reject) => {
      let settled = false
      let timer
      const fail = error => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        connectPromise = null
        cancelConnect = null
        reject(error)
      }
      cancelConnect = () => fail(connectionError('CANCELLED', 'Connection cancelled.'))
      let ws
      try { ws = new Socket(endpoint) } catch {
        fail(connectionError('CONNECTION_FAILED', 'Could not connect to the meeting server.'))
        return
      }
      socket = ws
      timer = setTimeout(() => {
        fail(connectionError('CONNECTION_TIMEOUT', 'The meeting server did not respond.'))
        ws.close()
      }, 10000)
      ws.addEventListener('open', () => {
        if (version !== epoch || disposed) { ws.close(); return }
        settled = true
        clearTimeout(timer)
        connectPromise = null
        cancelConnect = null
        resolve()
      })
      ws.addEventListener('message', event => { if (version === epoch && !disposed) receive(event.data) })
      ws.addEventListener('error', () => {
        if (version !== epoch || disposed) return
        fail(connectionError('CONNECTION_FAILED', 'Could not connect to the meeting server.'))
      })
      ws.addEventListener('close', () => {
        if (version !== epoch || disposed) return
        const error = connectionError('DISCONNECTED', 'Connection lost. Join the room again to continue.')
        fail(error)
        failPending(error)
        socket = null
        connectPromise = null
        state = { ...initialState(), status: 'error', error: { code: error.code, message: error.message } }
        publish()
        onEvent({ type: 'disconnected', error: state.error })
      })
    })
    const attempt = connectPromise
    attempt.catch(() => { if (connectPromise === attempt) connectPromise = null })
    return attempt
  }
  function send(message) {
    if (disposed || state.status !== 'joined' || socket?.readyState !== 1) return false
    try { socket.send(JSON.stringify(message)); return true } catch { return false }
  }
  async function enter(type, profile = {}, roomId) {
    if (state.status === 'joined') throw connectionError('ALREADY_JOINED', 'Leave your current room first.')
    if (joinPending) throw connectionError('CONNECTING', 'A room connection is already in progress.')
    joinPending = true
    try {
      await connect()
      if (disposed || socket?.readyState !== 1) throw connectionError('CANCELLED', 'Connection cancelled.')
      state.error = null
      state.status = 'connecting'
      publish()
      return await new Promise((resolve, reject) => {
        const requestId = String(++sequence)
        const timer = setTimeout(() => {
          pending.delete(requestId)
          reject(connectionError('REQUEST_TIMEOUT', 'The room did not respond. Please try again.'))
        }, 10000)
        pending.set(requestId, { resolve, reject, timer })
        socket.send(JSON.stringify({ type, requestId, name: profile.name, avatar: profile.avatar, ...(roomId ? { roomId } : {}) }))
      })
    } catch (error) {
      if (!disposed && error.code !== 'CANCELLED') {
        state = { ...initialState(), status: 'error', error: { code: error.code || 'CONNECTION_FAILED', message: error.message } }
        publish()
      }
      throw error
    } finally { joinPending = false }
  }
  function leave() {
    epoch++
    cancelConnect?.()
    cancelConnect = null
    connectPromise = null
    failPending(connectionError('CANCELLED', 'You left the room.'))
    if (socket) {
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'leave' }))
      socket.close()
      socket = null
    }
    state = initialState()
    lastPoseAt = 0
    publish()
  }
  return {
    createRoom: profile => enter('create', profile),
    joinRoom: (roomId, profile) => enter('join', profile, String(roomId || '').trim()),
    setName: name => send({ type: 'profile', name }),
    setAvatar: avatar => send({ type: 'profile', avatar }),
    sendPose(pose) {
      if (state.status !== 'joined') return false
      const now = Date.now()
      if (now - lastPoseAt < 50) return false
      lastPoseAt = now
      const sent = send({ type: 'pose', pose })
      if (sent) updatePose(state.selfId, pose)
      return sent
    },
    react: (reaction, { source = 'manual' } = {}) => send({ type: 'reaction', reaction, source }),
    sendChat: text => send({ type: 'chat', text }),
    setMedia(media) {
      const current = state.participants.find(participant => participant.id === state.selfId)?.media || { audio: false, video: false, screen: false }
      return send({ type: 'media', media: { ...current, ...media } })
    },
    sendSignal: (targetId, data) => send({ type: 'signal', targetId, data }),
    leave,
    dispose() { if (!disposed) { disposed = true; leave() } },
    getState,
  }
}
