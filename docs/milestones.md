# Milestones

This log records what each milestone delivers, what is still stubbed, how to test it, and where the build deviates from the [code brief](https://claude.ai/artifact/U7WFTEkYCNBqoMbKc4wo36) or the [design brief](https://claude.ai/artifact/CReom8skdLyjWosVMxfHDk), and why.

## Milestone 1: scaffold

### What works

- Vite, TypeScript, Three.js and Rapier, with strict ESLint rules, Prettier and Vitest.
- `WebGPURenderer` with automatic WebGL2 fallback, a `?webgl` override, device pixel ratio capped at 2, and a dynamic resolution scale hook.
- Rapier physics stepped by a fixed 60 Hz loop. Rendering interpolates between steps, and the loop pauses while the tab is hidden.
- A typed event bus for game-to-UI events and UI-to-game commands.
- The `?debug` overlay: frame rate, frame time, backend, draw calls, triangles, physics step time, body count and a time-scale slider.
- Design tokens from the design system as CSS variables, and self-hosted fonts.
- PWA manifest (fullscreen, landscape), offline cache and app icons.
- A test scene with 24 falling crates that proves rendering, physics and interpolation work together.

### Stubbed

- The test scene stands in for the game; milestone 2 replaces it with terrain and a vehicle.

### How to test

1. Run `npm run dev` and open the network URL on a phone.
2. Add `?debug` to the URL and check that the overlay shows about 60 fps.
3. Add `?debug&webgl` and check that the overlay shows `WEBGL2`.

### Deviations

- **Three.js r187 instead of r185.** r187 is the current release; the brief named the release that was current when it was written.
- **TypeScript 6.0.3, not 7.0.** `typescript-eslint` supports TypeScript below 6.1 only, and strict type-aware linting is worth more than the newer compiler.
- **Fonts come from `@fontsource` packages.** Vite bundles them, so they're self-hosted and cached offline as the brief asks.
- **Howler.js isn't installed yet.** Audio arrives in milestone 7.
- **The generic event bus lives in `src/engine/events.ts`.** The game's own event list will live in `src/game/events.ts`, as the brief's file layout shows.
- **Development-only audit warnings.** `npm audit` reports moderate issues in ESLint's and Workbox's build-time dependencies. The shipped game has no known vulnerabilities (`npm audit --omit=dev`).
