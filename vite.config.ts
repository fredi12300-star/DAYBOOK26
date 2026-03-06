import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
    host: true
  },
  optimizeDeps: {
    exclude: ['lucide-react']
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom', 'react-router-dom', 'lucide-react', '@supabase/supabase-js'],
          'excel': ['xlsx'],
          'pdf': ['jspdf', 'jspdf-autotable'],
          'viz': ['recharts'],
          'utils': ['date-fns', 'papaparse', 'uuid']
        }
      }
    }
  }
})
