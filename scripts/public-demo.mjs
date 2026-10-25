import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMeetingServer } from '../server/index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'output/public-demo')
const port = Number(process.env.DEMO_PORT) || 5190
const provider = process.env.DEMO_TUNNEL || 'cloudflare'
if (!['cloudflare', 'localhost-run'].includes(provider)) throw new Error('DEMO_TUNNEL must be cloudflare or localhost-run.')
await mkdir(output, { recursive: true })

if (!process.argv.includes('--skip-build')) {
  console.log('Building Together, Apart…')
  const build = spawn('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' })
  const code = await new Promise((resolveExit, reject) => { build.once('exit', resolveExit); build.once('error', reject) })
  if (code !== 0) throw new Error('Build failed; no public tunnel was opened.')
}
await readFile(resolve(root, 'dist/index.html'))

const meetings = process.argv.includes('--external-server') ? null : createMeetingServer({ host: '127.0.0.1', port, staticDir: resolve(root, 'dist'), env: { ...process.env, NODE_ENV: 'production' } })
let tunnel
let closing = false
const state = { status: 'starting', provider, pid: process.pid, port, url: null, startedAt: new Date().toISOString() }
const saveState = () => writeFile(resolve(output, 'state.json'), JSON.stringify(state, null, 2) + '\n')
async function close(code = 0) {
  if (closing) return
  closing = true
  state.status = 'stopped'
  state.stoppedAt = new Date().toISOString()
  tunnel?.kill('SIGTERM')
  await meetings?.close()
  await saveState()
  process.exitCode = code
}

try {
  if (meetings) await meetings.listen()
  else if (!(await fetch(`http://127.0.0.1:${port}/api/health`)).ok) throw new Error('The existing production server is not ready.')
  await saveState()
  console.log(`Production build running at http://127.0.0.1:${port}`)
  // Ignore unrelated saved Cloudflare configuration; this is an account-free demo tunnel.
  const tunnelEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TUNNEL_')))
  let command = 'cloudflared'
  const cloudflareConfig = resolve(output, 'cloudflared.yaml')
  await writeFile(cloudflareConfig, '{}\n')
  let args = ['tunnel', '--config', cloudflareConfig, '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`]
  if (provider === 'cloudflare' && process.env.DEMO_CLOUDFLARE_RELAY === '1') args.push('--quick-service', `http://127.0.0.1:${Number(process.env.DEMO_API_RELAY_PORT) || 15191}`, '--edge', `127.0.0.1:${Number(process.env.DEMO_EDGE_RELAY_PORT) || 17844}`)
  if (provider === 'localhost-run') {
    command = 'ssh'
    args = ['-T', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=output/public-demo/known_hosts', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-o', 'ConnectTimeout=15']
    if (process.env.DEMO_SSH_PROXY) {
      if (!/^[a-zA-Z0-9.-]+:\d+$/.test(process.env.DEMO_SSH_PROXY)) throw new Error('DEMO_SSH_PROXY must be a host:port HTTP proxy address.')
      args.push('-o', `ProxyCommand=nc -X connect -x ${process.env.DEMO_SSH_PROXY} %h %p`)
    }
    args.push('-R', `80:127.0.0.1:${port}`, 'nokey@localhost.run')
  }
  tunnel = spawn(command, args, { cwd: root, env: tunnelEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  state.tunnelPid = tunnel.pid
  await saveState()
  let recent = ''
  const handleLog = chunk => {
    const text = chunk.toString()
    appendFile(resolve(output, `${provider}.log`), text).catch(() => {})
    recent = (recent + text).slice(-10000)
    const match = [...recent.matchAll(/https:\/\/[a-z0-9-]+\.(?:trycloudflare\.com|lhr\.life)/g)].filter(candidate => candidate[0] !== 'https://api.trycloudflare.com').at(-1)
    if (match && match[0] !== state.url) {
      state.url = match[0]
      state.status = 'running'
      saveState().catch(() => {})
      console.log(`Public demo: ${state.url}`)
      console.log('Temporary address: keep this process and computer running. Restarting the tunnel changes the address.')
    }
  }
  tunnel.stdout.on('data', handleLog)
  tunnel.stderr.on('data', handleLog)
  tunnel.once('error', error => { console.error(`Could not start ${provider}: ${error.message}`); close(1) })
  tunnel.once('exit', code => {
    if (closing) return
    console.error(`Tunnel stopped (code ${code}). See output/public-demo/${provider}.log.`)
    close(code || 1)
  })
  process.once('SIGINT', () => close())
  process.once('SIGTERM', () => close())
} catch (error) {
  console.error(error.message)
  await close(1)
}
