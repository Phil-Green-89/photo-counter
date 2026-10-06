import preact from '@preact/preset-vite'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // GitHub Pages serves from /<repo>/, so CI sets BASE_PATH; locally it is '/'
  base: process.env.BASE_PATH ?? '/',
  test: { environment: 'happy-dom', include: ['src/**/*.test.ts'] },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Photo Counter',
        short_name: 'Counter',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0f14',
        theme_color: '#0b0f14',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // app shell is precached; the 14 MB wasm runtime and the model are cached on first use
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        runtimeCaching: [{
          urlPattern: ({ url }) => /\.(wasm|onnx)$/.test(url.pathname) || url.pathname.endsWith('/models/manifest.json'),
          handler: 'StaleWhileRevalidate',
          options: { cacheName: 'ml', cacheableResponse: { statuses: [200] } },
        }],
      },
    }),
  ],
})
