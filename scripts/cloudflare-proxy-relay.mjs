// Cloudflared's Quick Tunnel bootstrap does not read HTTP_PROXY. These two
// loopback-only relays let it use an existing HTTP CONNECT proxy without
// changing the computer's network settings or terminating tunnel TLS.
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'

const proxy = new URL(process.env.DEMO_HTTP_PROXY || 'http://127.0.0.1:7897')
if (proxy.protocol !== 'http:') throw new Error('DEMO_HTTP_PROXY must be an HTTP CONNECT proxy.')
const apiPort = Number(process.env.DEMO_API_RELAY_PORT) || 15191
const edgePort = Number(process.env.DEMO_EDGE_RELAY_PORT) || 17844
const edge = process.env.DEMO_CLOUDFLARE_EDGE || 'region1.v2.argotunnel.com:7844'
const sockets = new Set()

const api = http.createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/tunnel') { response.writeHead(404); response.end(); return }
  // The upstream response contains temporary tunnel credentials. Pipe it
  // directly to cloudflared; never log or persist its body.
  const child = spawn('curl', ['--proxy', proxy.href, '--silent', '--show-error', '--max-time', '20', '--request', 'POST', '--header', 'Content-Type: application/json', '--data-binary', '@-', 'https://api.trycloudflare.com/tunnel'], { stdio: ['pipe', 'pipe', 'pipe'] })
  response.setHeader('Content-Type', 'application/json')
  request.pipe(child.stdin)
  child.stdout.pipe(response)
  child.stderr.on('data', () => {})
  child.once('error', () => response.destroy())
  child.once('exit', code => { if (code !== 0) response.destroy() })
  request.once('error', () => child.kill())
})
const tcp = net.createServer(incoming => {
  sockets.add(incoming)
  incoming.once('close', () => sockets.delete(incoming))
  const request = http.request({ hostname: proxy.hostname, port: proxy.port || 80, method: 'CONNECT', path: edge, headers: { Host: edge }, timeout: 15000 })
  request.once('connect', (response, outgoing, head) => {
    if (response.statusCode !== 200) { incoming.destroy(); outgoing.destroy(); return }
    sockets.add(outgoing)
    outgoing.once('close', () => sockets.delete(outgoing))
    incoming.on('error', () => outgoing.destroy())
    outgoing.on('error', () => incoming.destroy())
    if (head.length) incoming.write(head)
    incoming.pipe(outgoing).pipe(incoming)
  })
  request.once('error', () => incoming.destroy())
  request.once('timeout', () => { request.destroy(); incoming.destroy() })
  request.end()
})
api.listen(apiPort, '127.0.0.1', () => console.log(`Quick Tunnel bootstrap relay: 127.0.0.1:${apiPort}`))
tcp.listen(edgePort, '127.0.0.1', () => console.log(`Cloudflare TLS pass-through relay: 127.0.0.1:${edgePort}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { sockets.forEach(socket => socket.destroy()); api.close(); tcp.close() })
