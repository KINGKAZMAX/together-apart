import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const origin = process.env.TEST_URL || 'http://127.0.0.1:5187'
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const pages = [await browser.newPage(), await browser.newPage()]
const errors = []
try {
  for (const [i, page] of pages.entries()) {
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/__media_check__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated media check</title><body></body>' }))
    await page.goto(`${origin}/__media_check__`)
    await page.exposeFunction('forwardSignal', (_peer, payload) => pages[1 - i].evaluate(({ from, payload }) => window.client.receiveSignal(from, payload), { from: i === 0 ? 'a' : 'b', payload }))
    await page.evaluate(async ({ id }) => {
      const NativePC = window.RTCPeerConnection
      window.connections = []; window.events = []; window.signals = []; window.remoteStreams = {}
      class InstrumentedPC extends NativePC {
        constructor(config) { super(config); window.connections.push(this); this.addEventListener('track', event => window.events.push({ type: 'track', kind: event.track.kind, id: event.track.id })) }
      }
      const { createMediaClient } = await import('/src/network/media-client.js')
      const mediaDevices = { getUserMedia: async constraints => {
        if (constraints.audio) {
          const context = new AudioContext(), destination = context.createMediaStreamDestination(), oscillator = context.createOscillator()
          oscillator.connect(destination); oscillator.start(); await context.resume()
          return destination.stream
        }
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480
        const ctx = canvas.getContext('2d'); let frame = 0
        setInterval(() => { ctx.fillStyle = frame++ % 2 ? '#456949' : '#f0e9d5'; ctx.fillRect(0, 0, 640, 480) }, 100)
        return canvas.captureStream(10)
      } }
      window.client = createMediaClient({ localId: id,
        onSignal: (peer, payload) => { window.signals.push({ peer, payload }); void window.forwardSignal(peer, payload) },
        onState: state => { window.mediaState = state },
        onStream: (peer, stream) => {
          window.remoteStreams[peer] = stream
          window.events.push({ type: 'stream', peer, tracks: stream?.getTracks().map(t => t.kind) })
          let video = document.querySelector('video')
          if (!video) { video = document.createElement('video'); video.muted = true; video.autoplay = true; document.body.append(video) }
          video.srcObject = stream; void video.play().catch(() => {})
        },
      }, { RTCPeerConnection: InstrumentedPC, mediaDevices })
    }, { id: i === 0 ? 'a' : 'b' })
  }
  await Promise.all(pages.map((page, i) => page.evaluate(id => window.client.setPeers([{ id }]), i === 0 ? 'b' : 'a')))
  await pages[0].waitForTimeout(1000)
  await Promise.all(pages.map(page => page.evaluate(async () => { await window.client.enableCamera(true); await window.client.enableMicrophone(true) })))
  await pages[0].waitForTimeout(2500)
  const diagnostics = await Promise.all(pages.map(page => page.evaluate(async () => ({
    events: window.events,
    media: { camera: window.mediaState?.camera, microphone: window.mediaState?.microphone, error: window.mediaState?.error },
    videos: [...document.querySelectorAll('video')].map(v => ({ width: v.videoWidth, time: v.currentTime, paused: v.paused })),
    connections: await Promise.all(window.connections.map(async pc => ({
      state: pc.connectionState, signaling: pc.signalingState,
      transceivers: pc.getTransceivers().map(t => ({ mid: t.mid, direction: t.direction, currentDirection: t.currentDirection, sender: t.sender.track && { kind: t.sender.track.kind, ready: t.sender.track.readyState }, receiver: { kind: t.receiver.track.kind, muted: t.receiver.track.muted, ready: t.receiver.track.readyState } })),
      localSdp: pc.localDescription?.sdp, remoteSdp: pc.remoteDescription?.sdp,
      stats: [...(await pc.getStats()).values()].filter(r => ['inbound-rtp', 'outbound-rtp'].includes(r.type)).map(r => ({ type: r.type, kind: r.kind, bytesSent: r.bytesSent, bytesReceived: r.bytesReceived, framesDecoded: r.framesDecoded, framesEncoded: r.framesEncoded })),
    }))),
  }))))
  await mkdir('output/media-browser-check', { recursive: true })
  await writeFile('output/media-browser-check/diagnostics.json', JSON.stringify({ diagnostics, errors }, null, 2))
  console.log(JSON.stringify(diagnostics.map(({ connections, ...rest }) => ({ ...rest, connections: connections.map(({ localSdp: _local, remoteSdp: _remote, ...connection }) => connection) })), null, 2))
  assert.deepEqual(errors, [])
  for (const result of diagnostics) {
    assert.ok(result.videos.some(v => v.width === 640 && v.time > 0), 'remote video must play')
    const stats = result.connections.flatMap(pc => pc.stats)
    assert.ok(stats.some(r => r.type === 'inbound-rtp' && r.kind === 'video' && r.framesDecoded > 0), 'remote video must decode')
    assert.ok(stats.some(r => r.type === 'inbound-rtp' && r.kind === 'audio' && r.bytesReceived > 0), 'remote audio must arrive')
  }
} finally { await browser.close() }
