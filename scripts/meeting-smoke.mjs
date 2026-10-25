import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
await mkdir('output/meeting-smoke', { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
const failures = [], assertions = []
const origin = process.env.TEST_URL || 'http://127.0.0.1:5187'
const first = await browser.newContext({ viewport: { width: 1440, height: 960 }, permissions: ['camera', 'microphone'] })
const second = await browser.newContext({ viewport: { width: 1440, height: 960 }, permissions: ['camera', 'microphone'] })
for (const context of [first, second]) await context.addInitScript(() => {
  const NativePC = window.RTCPeerConnection
  window.__testPeers = []
  window.RTCPeerConnection = class extends NativePC { constructor(...args) { super(...args); window.__testPeers.push(this) } }
  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 450
    const ctx = canvas.getContext('2d'); let n = 0
    const paint = () => { ctx.fillStyle = '#41665a'; ctx.fillRect(0, 0, 800, 450); ctx.fillStyle = '#fff'; ctx.font = '28px sans-serif'; ctx.fillText(`Synthetic shared screen ${n++}`, 40, 230) }
    paint(); const timer = setInterval(paint, 80), stream = canvas.captureStream(12)
    const stop = stream.getVideoTracks()[0].stop.bind(stream.getVideoTracks()[0])
    stream.getVideoTracks()[0].stop = () => { clearInterval(timer); stop() }
    return stream
  }
})
const a = await first.newPage(), b = await second.newPage()
for (const page of [a, b]) page.on('pageerror', error => failures.push(error.message))
const state = page => page.evaluate(() => JSON.parse(window.render_game_to_text()))
const waitState = (page, fn, arg) => page.waitForFunction(({ body, arg }) => Function('s', 'arg', `return (${body})(s,arg)`)(JSON.parse(window.render_game_to_text()), arg), { body: fn.toString(), arg }, { timeout: 30000 })
try {
  await a.goto(origin)
  await a.waitForFunction(() => window.render_game_to_text && JSON.parse(window.render_game_to_text()).modelLoaded)
  assert.equal(await a.locator('html').getAttribute('lang'), 'en')
  await a.fill('#display-name', 'Mina')
  await a.getByRole('button', { name: 'Your character: Maya', exact: true }).click()
  await waitState(a, s => s.localAvatar === 'maya' && s.viewMode === 'follow')
  assertions.push('English default, avatar selection and close follow')
  await a.screenshot({ path: 'output/meeting-smoke/01-preview-en.png', fullPage: true })
  await a.locator('.room-entry .primary').click()
  await waitState(a, s => s.room.status === 'joined')
  const room = (await state(a)).room.id
  assert.equal((await state(a)).npcCount, 0)
  const invitation = `${origin}/?room=${room}`
  await b.goto(origin)
  await b.waitForFunction(() => window.render_game_to_text && JSON.parse(window.render_game_to_text()).modelLoaded)
  await b.getByRole('button', { name: 'Join a room', exact: true }).click()
  await b.locator('.dialog #display-name').fill('Eli')
  await b.getByRole('button', { name: 'Your character: Sam', exact: true }).click()
  await b.locator('.join-code-label input').fill(invitation)
  await b.locator('.dialog .button.primary').click()
  await waitState(b, s => s.room.status === 'joined' && s.remoteCount === 1)
  await waitState(a, s => s.room.participants.length === 2 && s.remoteCount === 1)
  assert.notDeepEqual((await state(a)).player, (await state(b)).player)
  assertions.push('Full invitation URL joins a real room; two people; no demo NPCs')
  await a.getByRole('button', { name: 'Chat', exact: true }).click()
  await a.locator('.chat-compose input').fill('Can you see my character?')
  await a.getByRole('button', { name: 'Send', exact: true }).click()
  await waitState(b, s => s.room.messages.some(m => m.text === 'Can you see my character?'))
  assertions.push('Room chat travels to another browser')
  await b.getByRole('button', { name: 'Room view', exact: true }).click()
  for (const [label, type] of [['Agree', 'nod'], ['Applaud', 'clap'], ['Raise hand', 'raise']]) {
    await a.getByRole('button', { name: label, exact: true }).click()
    await waitState(b, (s, type) => s.remotes.some(r => r.name === 'Mina' && r.reaction?.type === type), type)
    await a.evaluate(() => window.advanceTime(3600)); await b.evaluate(() => window.advanceTime(3600))
    assert.equal((await state(b)).remotes[0].reaction, null)
  }
  assertions.push('All three reactions arrive above the correct remote avatar and expire')
  await a.getByRole('button', { name: 'People', exact: true }).click()
  await a.keyboard.down('ArrowRight'); await a.waitForTimeout(550); await a.keyboard.up('ArrowRight')
  const pos = (await state(a)).player
  await waitState(b, (s, pos) => Math.hypot(s.remotes[0].x - pos.x, s.remotes[0].z - pos.z) < 0.08, pos)
  assertions.push('Position moves and converges on the remote client')
  const selfId = (await state(a)).room.selfId
  await a.getByRole('button', { name: '切换到中文', exact: true }).click()
  assert.equal(await a.locator('html').getAttribute('lang'), 'zh-CN')
  await a.getByRole('button', { name: '手势', exact: true }).click()
  await a.screenshot({ path: 'output/meeting-smoke/02-room-zh.png', fullPage: true })
  assert.equal((await state(a)).room.selfId, selfId)
  await a.getByRole('button', { name: 'Switch to English', exact: true }).click()
  assertions.push('Language switches during a call without disconnecting')
  await a.getByRole('button', { name: 'Enable camera gestures', exact: true }).click()
  await waitState(a, s => ['calibrating', 'running', 'error'].includes(s.camera.state))
  const gestureOnly = await state(a)
  assert.notEqual(gestureOnly.camera.state, 'error', JSON.stringify(gestureOnly.camera))
  assert.equal(gestureOnly.media.camera, false)
  await waitState(b, s => !s.room.participants.find(p => p.name === 'Mina').media.video)
  assertions.push('Gesture-only camera capture stays private; real vision models initialize')
  await a.getByRole('button', { name: 'Turn on camera', exact: true }).click()
  await a.getByRole('button', { name: 'Turn on microphone', exact: true }).click()
  await b.getByRole('button', { name: 'Turn on camera', exact: true }).click()
  await b.getByRole('button', { name: 'Turn on microphone', exact: true }).click()
  await waitState(a, s => s.media.peers.some(p => p.connectionState === 'connected'))
  // Vision already initialized above. Stop expensive software-GPU inference for media checks.
  await a.getByRole('button', { name: 'Disable gestures', exact: true }).first().click()
  await b.getByRole('button', { name: 'Disable gestures', exact: true }).first().click()
  await b.waitForFunction(() => [...document.querySelectorAll('.media-tile:not(.local-video) video')].some(v => v.videoWidth > 0 && v.currentTime > 0), null, { timeout: 30000 })
  await a.waitForFunction(() => [...document.querySelectorAll('.media-tile:not(.local-video) video')].some(v => v.videoWidth > 0 && v.currentTime > 0), null, { timeout: 30000 })
  const inbound = await b.evaluate(async () => {
    const reports = await Promise.all(window.__testPeers.map(pc => pc.getStats()))
    return reports.flatMap(r => [...r.values()]).filter(r => r.type === 'inbound-rtp').map(r => ({ kind: r.kind, bytesReceived: r.bytesReceived, framesDecoded: r.framesDecoded }))
  })
  assert.ok(inbound.some(r => r.kind === 'video' && r.bytesReceived > 0 && r.framesDecoded > 0))
  assert.ok(inbound.some(r => r.kind === 'audio' && r.bytesReceived > 0))
  assertions.push('Real WebRTC receives decoded video frames and audio packets in both browser contexts')
  await a.screenshot({ path: 'output/meeting-smoke/03-two-person-call.png', fullPage: true })
  await a.getByRole('button', { name: 'Share your screen', exact: true }).click()
  await waitState(a, s => s.media.screen)
  await b.waitForFunction(() => [...document.querySelectorAll('.screen-tile video')].some(v => v.videoWidth === 800), null, { timeout: 30000 })
  await a.getByRole('button', { name: 'Stop sharing your screen', exact: true }).click()
  await waitState(a, s => !s.media.screen && s.media.camera && s.media.microphone)
  assertions.push('Synthetic screen share reaches the peer, then returns to webcam and keeps audio')
  await b.getByRole('button', { name: 'Leave', exact: true }).click()
  await waitState(a, s => s.room.participants.length === 1 && s.remoteCount === 0 && s.media.peers.length === 0)
  assertions.push('Leaving removes the remote avatar and closes peer media')
  await a.getByRole('button', { name: 'Leave', exact: true }).click()
  assert.equal((await state(a)).media.camera, false)
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await mobile.goto(origin); await mobile.waitForFunction(() => window.render_game_to_text && JSON.parse(window.render_game_to_text()).modelLoaded)
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await mobile.screenshot({ path: 'output/meeting-smoke/04-mobile.png', fullPage: true }); await mobile.close()
  assertions.push('390px layout has no horizontal overflow')
  assert.deepEqual(failures, [])
  const result = { assertions, inbound, failures, mediaSource: 'Chromium fake camera/microphone and synthetic canvas screen; not a cross-network or human-accuracy measurement' }
  await writeFile('output/meeting-smoke/results.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(error)
  for (const [name, page] of [['a', a], ['b', b]]) {
    await page.screenshot({ path: `output/meeting-smoke/failure-${name}.png`, fullPage: true }).catch(() => {})
    console.log(name, JSON.stringify(await state(page).catch(() => ({})), null, 2))
    console.log(name, await page.evaluate(async () => ({ videos: [...document.querySelectorAll('video')].map(v => ({ width: v.videoWidth, paused: v.paused, time: v.currentTime, tracks: v.srcObject?.getTracks().map(t => ({kind:t.kind, muted:t.muted, state:t.readyState})) })), peers: await Promise.all(window.__testPeers.map(async pc => ({ connection: pc.connectionState, transceivers: pc.getTransceivers().map(t => ({mid:t.mid, direction:t.currentDirection, sender:t.sender.track?.kind, receiver:t.receiver.track?.kind})), stats: [...(await pc.getStats()).values()].filter(s => /bound-rtp/.test(s.type)).map(s => ({type:s.type,kind:s.kind,bytes:s.bytesReceived||s.bytesSent,frames:s.framesDecoded||s.framesEncoded})) }))) })).catch(() => ({})))
  }
  process.exitCode = 1
} finally { await browser.close() }
