import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { dirname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = dirname(fileURLToPath(import.meta.url))
// MediaPipe's Emscripten runtime is dependency output: dev serves it straight
// from node_modules and build copies it into dist/wasm, so the generated files
// never land in the repo or in public/.
const wasmRoot = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')

function serveVisionWasm(req, res, next) {
  const relative = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '')
  const file = normalize(join(wasmRoot, relative))
  if (!file.startsWith(wasmRoot + sep) || !existsSync(file) || !statSync(file).isFile()) { next(); return }
  res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
  res.setHeader('Cache-Control', 'no-cache')
  createReadStream(file).pipe(res)
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'mediapipe-vision-wasm',
      configureServer(server) { server.middlewares.use('/wasm', serveVisionWasm) },
      closeBundle() { cpSync(wasmRoot, join(root, 'dist', 'wasm'), { recursive: true }) },
    },
  ],
  server: { proxy: { '/api': 'http://127.0.0.1:5188', '/socket': { target: 'ws://127.0.0.1:5188', ws: true } } },
  preview: { proxy: { '/api': 'http://127.0.0.1:5188', '/socket': { target: 'ws://127.0.0.1:5188', ws: true } } },
  build: {
    rolldownOptions: {
      input: { workshop: 'index.html', models: 'models.html' },
    },
  },
})
