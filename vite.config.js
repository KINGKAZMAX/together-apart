import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:5188', '/socket': { target: 'ws://127.0.0.1:5188', ws: true } } },
  preview: { proxy: { '/api': 'http://127.0.0.1:5188', '/socket': { target: 'ws://127.0.0.1:5188', ws: true } } },
  build: {
    rolldownOptions: {
      input: { workshop: 'index.html', models: 'models.html' },
    },
  },
})
