import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// El puerto de la API se lee de API_PORT, igual que en server/index.ts: si
// solo lo supiera una de las dos mitades, cambiarlo rompería el proxy.
const API_PORT = Number(process.env.API_PORT ?? 4321)

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': `http://localhost:${API_PORT}`,
    },
  },
})
