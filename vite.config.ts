import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
    manifest: {
      id: '/', name: 'Sub2api Manager', short_name: 'Sub2', description: '账号、额度与消费，一目了然。',
      lang: 'zh-CN', start_url: '/', scope: '/', display: 'standalone', background_color: '#f8f9fb', theme_color: '#f8f9fb',
      icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
    },
    workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/api(?:\/|$)/], cleanupOutdatedCaches: true, runtimeCaching: [] },
  })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: '127.0.0.1', port: Number(process.env.DEV_PORT ?? 5173), strictPort: true, proxy: { '/api': `http://127.0.0.1:${process.env.PORT ?? 3001}` } },
  build: { target: 'safari16.4' },
})
