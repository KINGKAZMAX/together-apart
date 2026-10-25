import test from 'node:test'
import assert from 'node:assert/strict'

const serverModule = await import('../server/index.js').catch(() => null)

test('meeting server exports a runnable factory', () => {
  assert.equal(typeof serverModule?.createMeetingServer, 'function')
})

async function fixture(t, options = {}) {
  assert.ok(serverModule, 'The meeting server must be implemented')
  const { WebSocket } = await import('ws')
  const server = serverModule.createMeetingServer({ port: 0, ...options })
  const address = await server.listen()
  const clients = []
  t.after(async () => {
    clients.forEach(client => client.ws.terminate())
    await server.close()
  })
  async function connect() {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/socket`)
    const queue = [], waits = []
    ws.on('message', raw => {
      const message = JSON.parse(raw)
      const index = waits.findIndex(wait => wait.type === message.type && (!wait.predicate || wait.predicate(message)))
      if (index === -1) queue.push(message)
      else waits.splice(index, 1)[0].resolve(message)
    })
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
    const client = {
      ws,
      send: message => ws.send(JSON.stringify(message)),
      next(type, predicate) {
        const index = queue.findIndex(message => message.type === type && (!predicate || predicate(message)))
        if (index !== -1) return Promise.resolve(queue.splice(index, 1)[0])
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 2000)
          waits.push({ type, predicate, resolve: value => { clearTimeout(timer); resolve(value) } })
        })
      },
      queue,
    }
    clients.push(client)
    return client
  }
  async function create(client, name = 'Alex') {
    client.send({ type: 'create', name, avatar: 'alex', requestId: 'create' })
    return client.next('joined')
  }
  async function join(client, roomId, name = 'Maya') {
    client.send({ type: 'join', roomId, name, avatar: 'maya', requestId: 'join' })
    return client.next('joined')
  }
  return { server, connect, create, join, url: `http://127.0.0.1:${address.port}` }
}

test('real clients create and join a room, then membership updates on disconnect', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect()
  const first = await f.create(a), second = await f.join(b, first.roomId)
  assert.match(first.roomId, /^[A-Za-z0-9_-]{16}$/)
  assert.notEqual(first.selfId, second.selfId)
  assert.equal(second.participants.length, 2)
  assert.deepEqual(second.participants.map(p => p.name), ['Alex', 'Maya'])
  await a.next('participants', message => message.participants.length === 2)
  b.ws.close()
  assert.equal((await a.next('participant-left')).participantId, second.selfId)
  assert.equal((await a.next('participants', message => message.participants.length === 1)).participants[0].id, first.selfId)
})

test('room chat, pose, reaction and media are validated and broadcast', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect()
  const first = await f.create(a)
  await f.join(b, first.roomId)
  a.send({ type: 'pose', pose: { x: 1.2, z: -2, rotation: 0.6 } })
  assert.deepEqual((await b.next('pose')).pose, { x: 1.2, z: -2, rotation: 0.6 })
  a.send({ type: 'reaction', reaction: 'nod', source: 'camera' })
  assert.equal((await b.next('reaction')).source, 'camera')
  a.send({ type: 'chat', text: ' Hello team ' })
  const chat = (await b.next('chat')).message
  assert.equal(chat.text, 'Hello team')
  assert.equal(chat.participantId, first.selfId)
  a.send({ type: 'media', media: { audio: true, video: false, screen: false } })
  const roster = await b.next('participants', msg => msg.participants[0].media.audio)
  assert.equal(roster.participants[0].media.audio, true)
  const c = await f.connect()
  assert.equal((await f.join(c, first.roomId)).messages[0].text, 'Hello team')
  a.send({ type: 'pose', pose: { x: 'bad', z: 1, rotation: 0 } })
  assert.equal((await a.next('error')).code, 'INVALID_POSE')
})

test('signaling can target only a member of the same room', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect(), outsider = await f.connect()
  const first = await f.create(a), second = await f.join(b, first.roomId), other = await f.create(outsider)
  a.send({ type: 'signal', targetId: second.selfId, data: { description: { type: 'offer', sdp: 'v=0\r\n' } } })
  const signal = await b.next('signal')
  assert.equal(signal.from, first.selfId)
  assert.equal(signal.data.description.type, 'offer')
  a.send({ type: 'signal', targetId: other.selfId, data: { candidate: null } })
  assert.equal((await a.next('error')).code, 'PEER_NOT_FOUND')
  outsider.send({ type: 'chat', text: 'private' })
  await outsider.next('chat')
  assert.equal(a.queue.some(message => message.type === 'chat' && message.message.text === 'private'), false)
})

test('rooms reject unknown links and a seventh participant', async t => {
  const f = await fixture(t), owner = await f.connect()
  const first = await f.create(owner)
  for (let i = 0; i < 5; i++) await f.join(await f.connect(), first.roomId, `Guest ${i}`)
  const extra = await f.connect()
  extra.send({ type: 'join', roomId: first.roomId, name: 'Extra', avatar: 'sam' })
  assert.equal((await extra.next('error')).code, 'ROOM_FULL')
  extra.send({ type: 'join', roomId: 'missingroom12345', name: 'Extra', avatar: 'sam' })
  assert.equal((await extra.next('error')).code, 'ROOM_NOT_FOUND')
})

test('leaving the final member removes the room immediately', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect()
  const first = await f.create(a)
  a.send({ type: 'leave' })
  await a.next('left')
  b.send({ type: 'join', roomId: first.roomId, name: 'Late', avatar: 'sam' })
  assert.equal((await b.next('error')).code, 'ROOM_NOT_FOUND')
  assert.equal((await f.create(b)).participants.length, 1)
})

test('message limits reject malformed, oversized and rapid requests', async t => {
  const f = await fixture(t), a = await f.connect()
  await f.create(a)
  a.ws.send('{broken')
  assert.equal((await a.next('error')).code, 'INVALID_JSON')
  a.send({ type: 'chat', text: 'a'.repeat(501) })
  assert.equal((await a.next('error')).code, 'INVALID_CHAT')
  a.send({ type: 'reaction', reaction: 'nod' })
  await a.next('reaction')
  a.send({ type: 'reaction', reaction: 'clap' })
  assert.equal((await a.next('error')).code, 'RATE_LIMITED')
  const oversized = await f.connect()
  const closed = new Promise(resolve => oversized.ws.once('close', resolve))
  oversized.ws.send('x'.repeat(33000))
  assert.equal(await closed, 1009)
})

test('public config exposes connection settings without room details or extra environment', async t => {
  const f = await fixture(t, { env: { TURN_URLS: 'turn:relay.example:3478', TURN_USERNAME: 'demo', TURN_CREDENTIAL: 'connection-token', UNRELATED_SECRET: 'never-send' } })
  const response = await fetch(`${f.url}/api/config`), config = await response.json()
  assert.equal(config.maxParticipants, 6)
  assert.deepEqual(config.iceServers, [{ urls: ['turn:relay.example:3478'], username: 'demo', credential: 'connection-token' }])
  assert.equal(JSON.stringify(config).includes('never-send'), false)
  assert.equal(config.rooms, undefined)
  assert.equal((await fetch(`${f.url}/api/health`)).status, 200)
  assert.equal((await fetch(`${f.url}/.env`)).status, 404)
})

test('websocket upgrades reject foreign browser origins and accept same-origin clients', async t => {
  const f = await fixture(t, { env: { NODE_ENV: 'production' } })
  const { WebSocket } = await import('ws')
  const bad = new WebSocket(f.url.replace('http:', 'ws:') + '/socket', { origin: 'https://unrelated.example' })
  t.after(() => bad.terminate())
  const rejection = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 500)
    bad.once('error', error => { clearTimeout(timer); resolve(error) })
  })
  assert.match(rejection?.message || 'Origin was accepted', /403/)
  const good = new WebSocket(f.url.replace('http:', 'ws:') + '/socket', { origin: f.url })
  t.after(() => good.terminate())
  await new Promise((resolve, reject) => { good.once('open', resolve); good.once('error', reject) })
})

test('server assigns all six newcomers distinct walkable spawn positions', async t => {
  const f = await fixture(t), owner = await f.connect(), room = await f.create(owner)
  let joined = room
  for (let i = 0; i < 5; i++) joined = await f.join(await f.connect(), room.roomId)
  assert.deepEqual(joined.participants.map(participant => [participant.pose.x, participant.pose.z]), [[0.05, 2.05], [-2.7, -0.3], [0.2, -1.95], [2.35, 0.15], [-2.7, 1.7], [2.4, 2.3]])
})

test('a replacement participant takes a free spawn seat after someone leaves', async t => {
  const f = await fixture(t), owner = await f.connect(), room = await f.create(owner)
  const middle = await f.connect()
  await f.join(middle, room.roomId)
  await f.join(await f.connect(), room.roomId)
  middle.send({ type: 'leave' })
  await middle.next('left')
  const replacement = await f.join(await f.connect(), room.roomId)
  const positions = replacement.participants.map(participant => `${participant.pose.x},${participant.pose.z}`)
  assert.equal(new Set(positions).size, 3)
})

test('browser meeting client drives real rooms and clears membership on connection loss', async t => {
  const clientModule = await import('../src/network/meeting-client.js').catch(() => null)
  assert.equal(typeof clientModule?.createMeetingClient, 'function')
  const f = await fixture(t)
  const { WebSocket } = await import('ws')
  const events = []
  const a = clientModule.createMeetingClient({ url: f.url.replace('http:', 'ws:') + '/socket', WebSocket, onEvent: event => events.push(event) })
  const b = clientModule.createMeetingClient({ url: f.url.replace('http:', 'ws:') + '/socket', WebSocket })
  t.after(() => { a.dispose(); b.dispose() })
  const first = await a.createRoom({ name: 'Alex', avatar: 'sam' })
  const second = await b.joinRoom(first.roomId, { name: 'Maya', avatar: 'maya' })
  assert.equal(second.participants.length, 2)
  b.sendChat('hello')
  await waitUntil(() => events.some(event => event.type === 'chat'))
  assert.equal(a.getState().messages[0].text, 'hello')
  b.leave()
  assert.equal(b.getState().selfId, null)
  await waitUntil(() => a.getState().participants.length === 1)
  await f.server.close()
  await waitUntil(() => a.getState().status === 'error')
  assert.equal(a.getState().roomId, null)
  assert.equal(a.getState().participants.length, 0)
})

test('browser meeting client reports invalid invitations and can retry', async t => {
  const clientModule = await import('../src/network/meeting-client.js').catch(() => null)
  assert.equal(typeof clientModule?.createMeetingClient, 'function')
  const f = await fixture(t)
  const { WebSocket } = await import('ws')
  const client = clientModule.createMeetingClient({ url: f.url.replace('http:', 'ws:') + '/socket', WebSocket })
  t.after(() => client.dispose())
  await assert.rejects(client.joinRoom('badlink', { name: 'Alex' }), { code: 'ROOM_NOT_FOUND' })
  assert.equal(client.getState().error.code, 'ROOM_NOT_FOUND')
  assert.equal((await client.createRoom({ name: 'Alex' })).status, 'joined')
})

test('browser client can cancel a pending connection and later start a new meeting', async t => {
  const { createMeetingClient } = await import('../src/network/meeting-client.js')
  const f = await fixture(t), { WebSocket } = await import('ws')
  const client = createMeetingClient({ url: f.url.replace('http:', 'ws:') + '/socket', WebSocket })
  t.after(() => client.dispose())
  const joining = client.createRoom({ name: 'Alex' })
  client.leave()
  await assert.rejects(joining, { code: 'CANCELLED' })
  assert.equal(client.getState().status, 'idle')
  assert.equal((await client.createRoom({ name: 'Alex' })).status, 'joined')
})

test('browser client retries after a WebSocket constructor failure', async t => {
  const { createMeetingClient } = await import('../src/network/meeting-client.js')
  const f = await fixture(t), { WebSocket } = await import('ws')
  let attempts = 0
  class FirstConnectionFails extends WebSocket {
    constructor(url) {
      if (++attempts === 1) throw new Error('Temporary connection setup failure')
      super(url)
    }
  }
  const client = createMeetingClient({ url: f.url.replace('http:', 'ws:') + '/socket', WebSocket: FirstConnectionFails })
  t.after(() => client.dispose())
  await assert.rejects(client.createRoom({ name: 'Alex' }), { code: 'CONNECTION_FAILED' })
  assert.equal((await client.createRoom({ name: 'Alex' })).status, 'joined')
})

async function waitUntil(predicate) {
  const timeout = Date.now() + 2000
  while (!predicate()) {
    assert.ok(Date.now() < timeout, 'Timed out waiting for client state')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
