import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/auth': 'http://127.0.0.1:8000',
      '/ws/audio': { target: 'ws://127.0.0.1:8000', ws: true, rewrite: (p) => p },
      '/ws/dashboard': { target: 'ws://127.0.0.1:8000', ws: true, rewrite: (p) => p },
    },
  },
})
