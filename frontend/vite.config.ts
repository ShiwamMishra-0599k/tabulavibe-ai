/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Pre-bundle the chart library so the first dashboard render doesn't trigger a dependency re-optimisation.
  optimizeDeps: { include: ['recharts'] },
  server: {
    port: 5173,
    // In development the browser calls /api on the Vite origin and Vite forwards it to FastAPI.
    // Override with API_PROXY_TARGET if port 8000 is taken.
    proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
