import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In local dev the frontend talks to the backend through this proxy, so the
// browser only ever calls same-origin (http://localhost:5173). Vite forwards
// the API paths to the backend on 127.0.0.1:3001 — no CORS, and no
// localhost/IPv6 mismatch. For this to be used, leave VITE_API_URL empty.
// (In production you serve the built files and set VITE_API_URL to your API.)
const API_TARGET = 'http://127.0.0.1:3001'
const proxy = Object.fromEntries(
  ['/auth', '/verify', '/history', '/admin', '/health'].map((p) => [
    p,
    { target: API_TARGET, changeOrigin: true },
  ])
)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy },
})
