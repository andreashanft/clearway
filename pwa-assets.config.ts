import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Generates the PNG and ICO app icons from public/icon.svg. Run `npm run icons`.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#0B1430' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#0B1430' } },
  },
  images: ['public/icon.svg'],
});
