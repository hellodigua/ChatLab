import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'src/',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/'),
      '~': resolve(__dirname, 'src/'),
      '@openchatlab': resolve(__dirname, 'packages'),
    },
  },
  plugins: [
    vue(),
    tailwindcss(),
    ui({
      ui: {
        colors: {
          primary: 'pink',
          neutral: 'zinc',
        },
      },
    }),
  ],
  build: {
    outDir: resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/index.html'),
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3400,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 3400,
    },
  },
})
