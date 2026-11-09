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

## Milestone 2: drive

### What works

- Hollow Creek's terrain: a 256 × 256 heightmap at 4 m per pixel (1,020 m square), a baked colour map with fields, the dirt route and the creek, about 1,200 trees, bushes and rocks, and a water strip. `npm run terrain` bakes these from `levels/<id>.terrain.json`.
- Faceted low-poly ground in 64 chunks that the camera culls, a matching Rapier heightfield collider, and walls at the map edge.
- Morning, dusk and noon lighting presets with a shadow box that follows the camera, and a sky-to-ground environment map so metal and glass reflect.
- The Bruiser: a detailed procedural bulldozer with animated crawler tracks, a liftable blade with a glowing edge, cab, exhaust and lights, driven by Rapier's ray-cast vehicle controller.
- Point-to-drive on the touch stick and the gamepad stick: the vehicle turns towards the stick, slows for sharp turns and reverses when the stick points behind it.
- Classic controls on the keyboard (W/S or arrows to drive and reverse, A/D to steer), Shift to brake, Space for Action. On a gamepad, holding a trigger switches to classic: stick steers, right trigger accelerates, left trigger brakes and reverses.
- Floating touch stick, Action and Brake buttons as in the phone mock, shown only after touch input.
- Follow camera: 30° field of view across the shorter screen side, pitched 55°, look-ahead in the direction of travel, three zoom presets and 45° rotation steps. Pinch and twist on touch, Q/R and Z/X or the mouse wheel on the keyboard, bumpers and the d-pad on a gamepad.
- The Bruiser's Action toggles push mode, which lifts the blade and its collider.

### Stubbed

- Steering assist towards the route waits for the route in milestone 4.
- Trees and bushes don't collide yet; milestone 3 makes them knockable.
- The Enter/Exit button and the classic and left-handed touch layouts arrive with milestones 5 and 6.

### How to test

1. Run `npm run dev` and open the network URL on a phone in landscape.
2. Put your left thumb anywhere in the lower-left area and point where you want to drive.
3. Hold **BRAKE**, and tap **BLADE** to lift and lower the blade.
4. Pinch to change zoom and twist two fingers to rotate the view.
5. On a desktop, drive with W/A/S/D, zoom with the mouse wheel and rotate with Q and R.
6. Add `?debug` to see speed, steering and throttle. The debug build also exposes `window.clearway` for console checks.

Measured on a desktop browser with WebGPU: 24–35 draw calls and 15–20k triangles across the three zoom presets.

### Deviations

- **Zoom presets are ground spans, not camera distances.** At a 30° field of view, a 45 m camera distance shows only about 24 m of ground, far tighter than the mocks. The presets now mean 25, 45 and 70 m of ground across the shorter screen side (camera distances of about 47, 84 and 131 m).
- **The keyboard uses classic steering.** Eight keyboard directions make point-to-drive jerky, so W/S drive and reverse and A/D steer. Touch and gamepad sticks use point-to-drive as the brief asks.
- **Level positions are `[x, z]` ground points.** Heights always come from the terrain, so the brief's `[x, 0, z]` triples became pairs.
- **Terrain is baked from a recipe.** The heightmap stays a hand-editable 8-bit PNG as the brief asks, but a script generates it, the colour map and the props from slopes, hills, channels and fields, and flattens the route and building pads.
- **The Bruiser runs on four hidden ray-cast wheels.** Front and rear wheels steer in opposite directions and a yaw assist lets it pivot like a crawler.
- **All props share one `BatchedMesh`.** Each prop is culled on its own and there is one material, which keeps draw calls low.
