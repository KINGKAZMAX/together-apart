import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'

const MAX_PARTICIPANTS = 6
const MAX_PACKET = 32768
const AVATARS = new Set(['alex', 'maya', 'jordan', 'sam'])
const SPAWNS = [[0.05, 2.05], [-2.7, -0.3], [0.2, -1.95], [2.35, 0.15], [-2.7, 1.7], [2.4, 2.3]]
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' }
const cleanText = (value, max) => typeof value === 'string' ? value.replace(/\p{Cc}/gu, ' ').trim().slice(0, max) : ''
const isObject = value => value && typeof value === 'object' && !Array.isArray(value)

function iceConfiguration(env) {
  const urls = (env.TURN_URLS || '').split(',').map(url => url.trim()).filter(url => /^turns?:/.test(url))
  if (!urls.length) return [{ urls: ['stun:stun.l.google.com:19302'] }]
  return [{ urls, ...(env.TURN_USERNAME ? { username: env.TURN_USERNAME } : {}), ...(env.TURN_CREDENTIAL ? { credential: env.TURN_CREDENTIAL } : {}) }]
}

/** In-memory meeting rooms. Restarting this process ends all rooms. */
export function createMeetingServer({ port = 5188, host = '127.0.0.1', staticDir = resolve('dist'), env = process.env } = {}) {
  const rooms = new Map()
  const clients = new Map()
  const publicConfig = { maxParticipants: MAX_PARTICIPANTS, iceServers: iceConfiguration(env) }
  const allowedOrigins = new Set((env.ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean))
  const root = resolve(staticDir)
  let closing = false

  function json(response, status, data) {
    response.writeHead(status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    response.end(JSON.stringify(data))
  }

  const httpServer = createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Method not allowed' })
    let pathname
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname) } catch { return json(response, 400, { error: 'Invalid URL' }) }
    if (pathname === '/api/health') return json(response, 200, { ok: true })
    if (pathname === '/api/config') return json(response, 200, publicConfig)
    if (pathname.startsWith('/api/') || pathname === '/socket') return json(response, 404, { error: 'Not found' })
    if (pathname.split('/').some(part => part.startsWith('.')) || pathname.includes('\\')) return json(response, 404, { error: 'Not found' })
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!file.startsWith(`${root}${sep}`)) return json(response, 404, { error: 'Not found' })
    try {
      const [actualRoot, actualFile] = await Promise.all([realpath(root), realpath(file)])
      if (!actualFile.startsWith(`${actualRoot}${sep}`)) return json(response, 404, { error: 'Not found' })
      const info = await stat(actualFile)
      if (!info.isFile()) return json(response, 404, { error: 'Not found' })
      response.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Content-Length': info.size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' })
      if (request.method === 'HEAD') return response.end()
      const stream = createReadStream(actualFile)
      stream.on('error', () => response.destroy())
      stream.pipe(response)
    } catch { json(response, 404, { error: 'Not found. Build the frontend first with npm run build.' }) }
  })
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PACKET, perMessageDeflate: false })
  httpServer.on('upgrade', (request, socket, head) => {
    let pathname
    try { pathname = new URL(request.url, 'http://localhost').pathname } catch { socket.destroy(); return }
    if (closing || pathname !== '/socket' || clients.size >= 1024) { socket.destroy(); return }
    if (request.headers.origin && !allowedOrigins.has(request.headers.origin)) {
      let allowed = false
      try {
        const origin = new URL(request.headers.origin), requested = new URL(`http://${request.headers.host}`)
        const localDevelopment = env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) && origin.hostname === requested.hostname
        allowed = ['http:', 'https:'].includes(origin.protocol) && (origin.host === requested.host || localDevelopment)
      } catch { /* Malformed origins are rejected. */ }
      if (!allowed) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws))
  })

  function send(client, message) {
    if (client.ws.readyState !== WebSocket.OPEN) return
    if (client.ws.bufferedAmount > 1024 * 1024) { client.ws.close(1013, 'Connection is too slow'); return }
    client.ws.send(JSON.stringify(message))
  }
  function error(client, code, message, requestId) { send(client, { type: 'error', code, message, ...(requestId ? { requestId } : {}) }) }
  function participants(room) { return [...room.members.values()].map(client => ({ id: client.id, name: client.name, avatar: client.avatar, pose: { ...client.pose }, media: { ...client.media } })) }
  function broadcast(room, message, exceptId) { room.members.forEach(client => { if (client.id !== exceptId) send(client, message) }) }
  function roster(room) { broadcast(room, { type: 'participants', participants: participants(room) }) }
  function leave(client) {
    const room = rooms.get(client.roomId)
    client.roomId = null
    if (!room) return
    room.members.delete(client.id)
    if (!room.members.size) rooms.delete(room.id)
    else { broadcast(room, { type: 'participant-left', participantId: client.id }); roster(room) }
  }
  function permitted(client, key, interval) {
    const now = Date.now(), last = client.limits[key] || 0
    if (now - last < interval) return false
    client.limits[key] = now
    return true
  }
  function join(client, room, message) {
    client.name = cleanText(message.name, 32) || 'Guest'
    client.avatar = AVATARS.has(message.avatar) ? message.avatar : 'alex'
    client.roomId = room.id
    const occupied = new Set([...room.members.values()].map(member => member.seat))
    client.seat = SPAWNS.findIndex((_, index) => !occupied.has(index))
    const spawn = SPAWNS[client.seat]
    client.pose = { x: spawn[0], z: spawn[1], rotation: 0 }
    client.media = { audio: false, video: false, screen: false }
    room.members.set(client.id, client)
    send(client, { type: 'joined', requestId: message.requestId, selfId: client.id, roomId: room.id, participants: participants(room), messages: room.messages })
    broadcast(room, { type: 'participant-joined', participantId: client.id }, client.id)
    roster(room)
  }

  wss.on('connection', ws => {
    const client = { id: randomUUID(), ws, roomId: null, limits: {}, tokens: 120, tokenAt: Date.now(), alive: true }
    clients.set(client.id, client)
    ws.on('pong', () => { client.alive = true })
    ws.on('error', () => { /* A malformed or disconnected socket must not crash other rooms. */ })
    ws.on('close', () => { leave(client); clients.delete(client.id) })
    ws.on('message', (raw, binary) => {
      const now = Date.now()
      client.tokens = Math.min(120, client.tokens + (now - client.tokenAt) * 0.06)
      client.tokenAt = now
      if (client.tokens < 1) { ws.close(1008, 'Too many messages'); return }
      client.tokens -= 1
      if (binary) return error(client, 'INVALID_MESSAGE', 'Only JSON messages are accepted.')
      let message
      try { message = JSON.parse(raw.toString()) } catch { return error(client, 'INVALID_JSON', 'Invalid message.') }
      if (!isObject(message) || typeof message.type !== 'string') return error(client, 'INVALID_MESSAGE', 'Invalid message.')
      const requestId = typeof message.requestId === 'string' ? message.requestId.slice(0, 64) : undefined
      const fail = (code, text) => error(client, code, text, requestId)
      if (message.type === 'leave') { leave(client); send(client, { type: 'left' }); return }
      if (message.type === 'create' || message.type === 'join') {
        if (client.roomId) return fail('ALREADY_JOINED', 'Leave your current room first.')
        if (message.type === 'create') {
          if (!permitted(client, 'create', 1000)) return fail('RATE_LIMITED', 'Please wait a moment before creating another room.')
          if (rooms.size >= 1000) return fail('SERVER_FULL', 'The server is busy. Please try again later.')
          const id = randomBytes(12).toString('base64url')
          const room = { id, members: new Map(), messages: [] }
          rooms.set(id, room)
          join(client, room, { ...message, requestId })
        } else {
          const room = typeof message.roomId === 'string' && rooms.get(message.roomId)
          if (!room) return fail('ROOM_NOT_FOUND', 'This room has ended or the link is invalid.')
          if (room.members.size >= MAX_PARTICIPANTS) return fail('ROOM_FULL', 'This room already has six participants.')
          join(client, room, { ...message, requestId })
        }
        return
      }
      const room = rooms.get(client.roomId)
      if (!room) return fail('NOT_JOINED', 'Join a room first.')
      switch (message.type) {
        case 'profile': {
          if (message.name !== undefined) {
            if (typeof message.name !== 'string' || !cleanText(message.name, 32)) return fail('INVALID_NAME', 'Enter a display name.')
            client.name = cleanText(message.name, 32)
          }
          if (message.avatar !== undefined) {
            if (!AVATARS.has(message.avatar)) return fail('INVALID_AVATAR', 'Choose one of the available characters.')
            client.avatar = message.avatar
          }
          roster(room)
          break
        }
        case 'pose': {
          const pose = message.pose
          if (!isObject(pose) || !['x', 'z', 'rotation'].every(key => Number.isFinite(pose[key])) || Math.abs(pose.x) > 50 || Math.abs(pose.z) > 50 || Math.abs(pose.rotation) > 100) return fail('INVALID_POSE', 'Invalid position.')
          if (!permitted(client, 'pose', 40)) return
          client.pose = { x: pose.x, z: pose.z, rotation: pose.rotation }
          broadcast(room, { type: 'pose', participantId: client.id, pose: client.pose }, client.id)
          break
        }
        case 'reaction': {
          if (!['nod', 'clap', 'raise'].includes(message.reaction) || (message.source !== undefined && !['manual', 'camera'].includes(message.source))) return fail('INVALID_REACTION', 'Unknown reaction.')
          if (!permitted(client, 'reaction', 250)) return fail('RATE_LIMITED', 'Please wait a moment before reacting again.')
          broadcast(room, { type: 'reaction', participantId: client.id, reaction: message.reaction, source: message.source || 'manual', timestamp: now })
          break
        }
        case 'chat': {
          if (typeof message.text !== 'string' || message.text.length > 500 || !cleanText(message.text, 500)) return fail('INVALID_CHAT', 'Messages must contain 1–500 characters.')
          if (!permitted(client, 'chat', 400)) return fail('RATE_LIMITED', 'Please wait a moment before sending another message.')
          const chat = { id: randomUUID(), participantId: client.id, name: client.name, text: cleanText(message.text, 500), timestamp: now }
          room.messages.push(chat)
          if (room.messages.length > 50) room.messages.shift()
          broadcast(room, { type: 'chat', message: chat })
          break
        }
        case 'media': {
          if (!isObject(message.media) || !['audio', 'video', 'screen'].every(key => typeof message.media[key] === 'boolean')) return fail('INVALID_MEDIA', 'Invalid media state.')
          client.media = { audio: message.media.audio, video: message.media.video, screen: message.media.screen }
          roster(room)
          break
        }
        case 'signal': {
          const peer = room.members.get(message.targetId)
          if (!peer || peer.id === client.id) return fail('PEER_NOT_FOUND', 'That participant is no longer in this room.')
          if (!isObject(message.data) || Buffer.byteLength(JSON.stringify(message.data)) > 24576) return fail('INVALID_SIGNAL', 'Invalid connection message.')
          send(peer, { type: 'signal', from: client.id, data: message.data })
          break
        }
        default: fail('UNKNOWN_MESSAGE', 'Unknown message type.')
      }
    })
  })
  const heartbeat = setInterval(() => {
    clients.forEach(client => {
      if (!client.alive) { client.ws.terminate(); return }
      client.alive = false
      client.ws.ping()
    })
  }, 30000)
  heartbeat.unref()

  return {
    httpServer,
    listen: () => new Promise((resolveListen, reject) => {
      const fail = error => { httpServer.off('listening', ready); reject(error) }
      const ready = () => { httpServer.off('error', fail); resolveListen(httpServer.address()) }
      httpServer.once('error', fail)
      httpServer.once('listening', ready)
      httpServer.listen(port, host)
    }),
    close: () => new Promise(resolveClose => {
      closing = true
      clearInterval(heartbeat)
      clients.forEach(client => client.ws.terminate())
      rooms.clear()
      wss.close(() => {
        if (!httpServer.listening) return resolveClose()
        httpServer.close(() => resolveClose())
        httpServer.closeIdleConnections?.()
      })
    }),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createMeetingServer({ port: Number(process.env.PORT) || 5188, host: process.env.HOST || '127.0.0.1' })
  server.listen().then(address => console.log(`Together, Apart meeting server: http://${address.address}:${address.port}`)).catch(error => { console.error(error.message); process.exitCode = 1 })
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close().then(() => { process.exitCode = 0 }))
}
