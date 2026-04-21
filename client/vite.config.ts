/// <reference types="vitest" />
import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('./package.json') as { version: string }

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// libsodium-wrappers ESM билд содержит сломанный импорт ./libsodium.mjs
// Перенаправляем на CJS версию через абсолютный путь (обходит exports restrictions)
const libsodiumCjs = path.resolve(__dirname, 'node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js')

const libsodiumCjsPlugin: Plugin = {
  name: 'libsodium-cjs-resolver',
  enforce: 'pre',
  resolveId(id) {
    if (id === 'libsodium-wrappers') return libsodiumCjs
  }
}

export default defineConfig({
  plugins: [
    libsodiumCjsPlugin,
    react(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'Messenger',
        short_name: 'Messenger',
        description: 'Secure E2E encrypted messenger',
        theme_color: '#075E54',
        background_color: '#111B21',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 МБ (libsodium увеличивает бандл)
        importScripts: ['/push-handler.js'],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'messenger-api',
              networkTimeoutSeconds: 5,  // при плохой сети быстро переходим к кэшу
            }
          },
          {
            urlPattern: /^\/media\//,
            handler: 'CacheFirst',
            options: { cacheName: 'messenger-media' }
          }
        ]
      },
      devOptions: { enabled: true }
    })
  ],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(
      process.env.VITE_APP_VERSION ?? pkg.version
    ),
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') }
  },
  server: {
    port: 3000,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8080', ws: true, changeOrigin: true },
      '/media': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // sumo-версия нужна для crypto_auth_hmacsha256, используемой в ratchet.ts
    alias: {
      'libsodium-wrappers': 'libsodium-wrappers-sumo',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: {
        lines: 60,
        functions: 60,
      },
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx'],
    },
  },
})
