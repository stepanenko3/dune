import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Сайт працює через Snotax console: dune.test → host.docker.internal:5180 (див. .snotax.yaml).
// Тому Vite слухає всі інтерфейси і приймає проксований Host; /api, тайли мапи і знімки версій
// віддає API-сервер (server/index.mjs, :5181).
const API = `http://127.0.0.1:${process.env.API_PORT || 5181}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    host: true,
    allowedHosts: true,
    proxy: { '/api': API, '/map-tiles': API, '/versions': API },
  },
  resolve: { alias: { '@': '/src' } },
  build: { chunkSizeWarningLimit: 1200 },
})
