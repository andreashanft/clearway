import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// The game ships as a static, installable progressive web app (PWA).
// `base: './'` keeps every asset path relative, so the build runs from any folder on any host.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    // Rapier inlines its WebAssembly module, which makes one large chunk unavoidable.
    chunkSizeWarningLimit: 6000,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Clearway',
        short_name: 'Clearway',
        description: 'Clear the route before the Hauler arrives.',
        display: 'fullscreen',
        orientation: 'any',
        background_color: '#0B1430',
        theme_color: '#0B1430',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,json,mp3}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
