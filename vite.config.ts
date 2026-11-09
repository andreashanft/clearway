import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

const NAVY = '#0B1430';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  // A relative base lets the static build run from any folder or host.
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    // Rapier's compat build inlines its WASM, so its chunk is large by design.
    chunkSizeWarningLimit: 4500,
    rolldownOptions: {
      output: {
        // Separate vendor chunks stay cached when only game code changes.
        codeSplitting: {
          groups: [
            { name: 'rapier', test: /node_modules[\\/]@dimforge/ },
            { name: 'three', test: /node_modules[\\/]three/ },
          ],
        },
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Clearway',
        short_name: 'Clearway',
        description: "Clear the Hauler's route before it hits anything.",
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: NAVY,
        theme_color: NAVY,
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,json}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
