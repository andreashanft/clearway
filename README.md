# Clearway

Clearway is a browser demolition-puzzle game prototype. An unstoppable Hauler drives a fixed route, and you clear everything in its way before it arrives. It runs on phones, iPads and desktops as an installable progressive web app (PWA).

## Requirements

- Node.js 22 or later (`.nvmrc` pins 24)
- npm 10 or later

## Run the game

To install dependencies and start the development server, run:

```bash
npm install
```

```bash
npm run dev
```

The server prints a local URL and a network URL. The game opens at the local URL.

## Test on a phone or tablet

The development server listens on your local network, so a phone on the same Wi-Fi can open the network URL that `npm run dev` prints.

Browsers only allow WebGPU, service workers and home-screen installs on secure origins. Over plain HTTP on your network, the game falls back to WebGL2 and doesn't install. To test the full PWA, serve the production build over HTTPS, for example through a tunnel.

## Launch options

Add these query parameters to the URL:

| Parameter   | Effect                                                                                |
| ----------- | ------------------------------------------------------------------------------------- |
| `?debug`    | Shows the debug overlay: frame rate, draw calls, physics cost and a time-scale slider |
| `?webgl`    | Forces the WebGL2 backend even when WebGPU is available                               |
| `?level=ID` | Loads a level directly (from milestone 4)                                             |

You can combine them, for example `?debug&webgl`.

## Scripts

| Command           | What it does                                             |
| ----------------- | -------------------------------------------------------- |
| `npm run dev`     | Starts the development server with hot reload            |
| `npm run build`   | Type-checks and builds the static site into `dist/`      |
| `npm run preview` | Serves the production build locally                      |
| `npm run check`   | Runs the type check, linter, format check and unit tests |
| `npm test`        | Runs the unit tests with Vitest                          |
| `npm run lint`    | Lints with ESLint (strict, type-aware rules)             |
| `npm run format`  | Formats every file with Prettier                         |
| `npm run icons`   | Regenerates the app icons from `public/icon.svg`         |

The build uses a relative base path, so you can host `dist/` from any folder on any static host.

## Project structure

```text
index.html            Page shell: the canvas and the UI layer
public/               App icons
src/
  main.ts             Boot: renderer, physics, fixed-step loop
  engine/             Renderer, physics, loop, events, launch flags
  game/               Gameplay (levels, Hauler, vehicles, destruction)
  ui/                 Design tokens, fonts, screens and HUD
  debug/              The ?debug overlay
tests/                Unit tests (Vitest)
docs/milestones.md    Progress, deviations from the brief and test notes
```

## Technology

The game uses these pinned versions:

| Layer           | Package                                                            | Version |
| --------------- | ------------------------------------------------------------------ | ------- |
| Rendering       | `three` (WebGPURenderer with WebGL2 fallback)                      | 0.187.0 |
| Physics         | `@dimforge/rapier3d-compat`                                        | 0.21.0  |
| Build           | `vite`                                                             | 8.3.5   |
| Language        | `typescript`                                                       | 6.0.3   |
| PWA             | `vite-plugin-pwa`                                                  | 2.0.0   |
| Tests           | `vitest`                                                           | 5.0.5   |
| Lint and format | `eslint` 10.13.0, `typescript-eslint` 8.72.1, `prettier` 3.9.10    |         |
| Fonts           | `@fontsource` Big Shoulders Display, Space Grotesk, JetBrains Mono | 5.3.0   |

## Licence

Clearway is free software under the GNU General Public License v3.0 or later. See [LICENSE](LICENSE). The fonts use the SIL Open Font License 1.1.
