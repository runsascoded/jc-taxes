import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dvc from 'vite-plugin-dvc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dvc({ root: 'public' })],

  server: {
    port: 3201,  // JC area code
  },

  optimizeDeps: {
    exclude: ['scrns'],
  },
})
