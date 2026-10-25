// Watchdog for the public demo started by scripts/public-demo.mjs.
// Each round it checks the public tunnel URL (2xx/3xx), the local server on
// 127.0.0.1:<port>, and every *Pid listed in output/public-demo/processes.json.
// It is alarm-only: nothing is ever restarted automatically.
//
// Configuration (re-read every round):
//   url   = DEMO_URL  or output/public-demo/state.json#url   (processes.json#url as fallback)
//   port  = DEMO_PORT or output/public-demo/state.json#port  (processes.json#port, then 5190)
//   pids  = output/public-demo/processes.json
//   DEMO_INTERVAL = seconds between rounds, default 30
//   DEMO_HTTP_PROXY = optional HTTP CONNECT proxy for the public URL probe,
//                     e.g. http://127.0.0.1:7897 on networks without direct egress
// Results are appended as one JSON line per round to output/monitor/monitor.jsonl.
//
// Usage:
//   node scripts/monitor-demo.mjs          long-running watch, Ctrl-C to stop
//   node scripts/monitor-demo.mjs --once   single round, for cron or manual inspection
//
// Keep it running for a whole deployment with nohup:
//   nohup node scripts/monitor-demo.mjs >> output/monitor/monitor.log 2>&1 &
//   echo $! > output/monitor/monitor.pid   # stop later with kill $(cat output/monitor/monitor.pid)
//   tail -f output/monitor/monitor.log     # watch for !!! ALARM !!! lines live

import { spawn } from 'node:child_process'
import { mkdir, readFile, appendFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stateFile = resolve(root, 'output/public-demo/state.json')
const processesFile = resolve(root, 'output/public-demo/processes.json')
const output = resolve(root, 'output/monitor')
const logFile = resolve(output, 'monitor.jsonl')
const intervalSeconds = Number(process.env.DEMO_INTERVAL) || 30
if (!Number.isFinite(intervalSeconds) || intervalSeconds < 1) throw new Error('DEMO_INTERVAL must be a positive number of seconds.')
const once = process.argv.includes('--once')

const readJson = async file => { try { return JSON.parse(await readFile(file, 'utf8')) } catch { return null } }

// Node fetch ignores HTTP(S)_PROXY, and this machine only reaches the public
// tunnel through its local proxy, so route the probe through curl when configured.
const probeViaCurl = url => new Promise(resolveProbe => {
  const args = ['--silent', '--show-error', '--max-time', '10', '--output', '/dev/null', '--write-out', '%{http_code}']
  if (process.env.DEMO_HTTP_PROXY) args.push('--proxy', process.env.DEMO_HTTP_PROXY)
  const curl = spawn('curl', [...args, url], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let failed = ''
  curl.stdout.on('data', chunk => { out += chunk })
  curl.stderr.on('data', chunk => { failed += chunk })
  curl.once('error', error => resolveProbe({ ok: false, error: error.message }))
  curl.once('close', code => { code === 0 && Number(out) ? resolveProbe({ status: Number(out) }) : resolveProbe({ ok: false, error: `curl exit ${code}: ${failed.trim() || out.trim()}` }) })
})

const probe = async (url, acceptable = () => true) => {
  if (!url) return { ok: false, error: 'not configured' }
  const result = await probeViaCurl(url)
  if (!result.status) return result
  return acceptable(result.status) ? { ok: true, status: result.status } : { ok: false, status: result.status }
}

const alivePids = async pids => {
  const text = await new Promise(resolveRun => {
    const ps = spawn('ps', ['-o', 'pid=', '-p', pids.join(',')], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    ps.stdout.on('data', chunk => { out += chunk })
    ps.once('error', () => resolveRun(null))
    ps.once('close', () => resolveRun(out))
  })
  if (text === null) return null
  return new Set(text.split('\n').map(line => Number(line.trim())).filter(pid => pid > 0))
}

const describeCheck = check => check.ok || check.status ? `HTTP ${check.status}` : check.error

const checkPids = async manifest => {
  if (!manifest) return { ok: false, error: 'processes.json missing or unreadable', total: 0, alive: 0, dead: [] }
  const listed = Object.entries(manifest)
    .map(([name, value]) => ({ name, pid: Number(value) }))
    .filter(entry => /pid$/i.test(entry.name) && Number.isInteger(entry.pid) && entry.pid > 0)
  if (!listed.length) return { ok: false, error: 'no pids listed in processes.json', total: 0, alive: 0, dead: [] }
  const alive = await alivePids(listed.map(entry => entry.pid))
  if (!alive) return { ok: false, error: 'ps failed', total: listed.length, alive: 0, dead: listed }
  const dead = listed.filter(entry => !alive.has(entry.pid))
  return { ok: dead.length === 0, total: listed.length, alive: listed.length - dead.length, dead }
}

async function runRound() {
  const time = new Date().toISOString()
  const state = await readJson(stateFile)
  const processes = await readJson(processesFile)
  const url = process.env.DEMO_URL || state?.url || processes?.url || null
  const port = Number(process.env.DEMO_PORT) || state?.port || processes?.port || 5190
  const publicCheck = await probe(url, status => status >= 200 && status < 400)
  const localCheck = await probe(`http://127.0.0.1:${port}/`)
  const pidCheck = await checkPids(processes)
  const ok = publicCheck.ok && localCheck.ok && pidCheck.ok
  const alarms = []
  if (!publicCheck.ok) alarms.push(`public URL ${url ?? '(none)'} not usable: ${describeCheck(publicCheck)}`)
  if (!localCheck.ok) alarms.push(`local server http://127.0.0.1:${port}/ unreachable: ${describeCheck(localCheck)}`)
  if (!pidCheck.ok) alarms.push(pidCheck.error ?? `dead pids: ${pidCheck.dead.map(entry => `${entry.name}=${entry.pid}`).join(', ')}`)
  for (const alarm of alarms) console.error(`!!! ALARM !!! [${time}] ${alarm}`)
  console.log(`[${time}] ${ok ? 'OK  ' : 'FAIL'} public=${describeCheck(publicCheck)} local=${describeCheck(localCheck)} pids=${pidCheck.alive}/${pidCheck.total}`)
  const record = { time, ok, url, port, checks: { public: publicCheck, local: localCheck, pids: pidCheck }, alarms }
  await appendFile(logFile, JSON.stringify(record) + '\n')
  return record
}

let stopped = false
process.once('SIGINT', () => { stopped = true })
process.once('SIGTERM', () => { stopped = true })
const sleep = ms => new Promise(resolveSleep => {
  const timer = setTimeout(wake, ms)
  function wake() {
    clearTimeout(timer)
    process.off('SIGINT', wake)
    process.off('SIGTERM', wake)
    resolveSleep()
  }
  process.once('SIGINT', wake)
  process.once('SIGTERM', wake)
})

await mkdir(output, { recursive: true })
console.log(`Monitoring the public demo every ${intervalSeconds}s${once ? ' (--once)' : ''}; alarm-only, results in output/monitor/monitor.jsonl.`)
while (!stopped) {
  await runRound()
  if (once || stopped) break
  await sleep(intervalSeconds * 1000)
}
if (stopped) console.log('Monitor stopped.')
