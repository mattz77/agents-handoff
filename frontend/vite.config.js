import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/ops/static/dist/',
  server: {
    port: 5173,
    proxy: {
      // dev local: API real do container handoff-daemon
      '/ops/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
})
