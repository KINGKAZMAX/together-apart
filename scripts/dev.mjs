import { createServer } from 'vite'
import { createMeetingServer } from '../server/index.js'
const meetings = createMeetingServer({ port: 5188, host: '127.0.0.1' })
let web
try {
  await meetings.listen()
  web = await createServer({ server: { host: '127.0.0.1', port: 5187, strictPort: true } })
  await web.listen()
  web.printUrls()
  console.log('Meeting rooms and signaling are ready.')
} catch (error) {
  console.error(error.message)
  await meetings.close().catch(() => {})
  process.exit(1)
}
let closing = false
async function close() { if (closing) return; closing = true; await Promise.allSettled([web?.close(), meetings.close()]); process.exit(0) }
process.on('SIGINT', close)
process.on('SIGTERM', close)
