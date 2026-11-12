# Clearway

Clearway is a demolition-puzzle game for the browser. An unstoppable Hauler drives one straight line across each level, and you clear everything in its way before it arrives. The game runs on phones, tablets and desktops as an installable progressive web app (PWA).

The game is a prototype. The [milestones](#milestones) section lists what works today.

## Run the game

You need Node.js 22.12 or later.

1. Install the dependencies:

   ```bash
   npm install
   ```

2. Start the development server:

   ```bash
   npm run dev
   ```

3. Open the address that the server prints.

To test on a phone or tablet in the same network, start the server with `npm run dev -- --host` and open the network address on the device.

## Build the game

The following command checks the types and writes a static site to `dist/`:

```bash
npm run build
```

You can host the `dist/` folder on any static web server. All asset paths are relative.

## Check the code

The following command runs the type check, the linter, the format check and the unit tests:

```bash
npm run check
```

## URL parameters

| Parameter | Effect                                                                 |
| --------- | ---------------------------------------------------------------------- |
| `?debug`  | Shows the debug overlay with frame statistics and a time-scale slider. |
| `?webgl`  | Forces the WebGL2 backend. Without it, the game prefers WebGPU.        |

## Technology

The project pins exact package versions.

| Layer     | Package                                         | Version |
| --------- | ----------------------------------------------- | ------- |
| Rendering | `three` (`WebGPURenderer` with WebGL2 fallback) | 0.187.0 |
| Physics   | `@dimforge/rapier3d-compat`                     | 0.21.0  |
| Language  | `typescript`                                    | 6.0.3   |
| Build     | `vite`                                          | 8.3.8   |
| PWA       | `vite-plugin-pwa`                               | 2.0.0   |
| Tests     | `vitest`                                        | 5.1.0   |
| Linting   | `eslint` with `typescript-eslint`               | 10.14.0 |
| Format    | `prettier`                                      | 3.10.1  |

The user interface is plain DOM and CSS above the canvas. `src/ui/tokens.css` holds the design tokens.

## Project layout

| Path          | Content                                                  |
| ------------- | -------------------------------------------------------- |
| `src/main.ts` | Boot sequence and frame loop.                            |
| `src/engine/` | Renderer, physics world and fixed-step loop.             |
| `src/game/`   | Game simulation.                                         |
| `src/ui/`     | Design tokens, fonts and DOM user interface.             |
| `src/debug/`  | Debug overlay.                                           |
| `tests/`      | Unit tests.                                              |
| `tools/`      | Scripts that generate assets, for example the app icons. |
| `public/`     | Static files: icons and the favicon.                     |

## Milestones

| #   | Milestone           | State   |
| --- | ------------------- | ------- |
| 1   | Scaffold            | Done    |
| 2   | Drive               | Planned |
| 3   | Destroy             | Planned |
| 4   | Hauler loop         | Planned |
| 5   | Screens             | Planned |
| 6   | Vehicles and levels | Planned |
| 7   | Polish              | Planned |

### Milestone 1: scaffold

- **Works:** Vite, TypeScript, Three.js and Rapier run together. The simulation advances in fixed 60 Hz steps and the renderer interpolates between them. The PWA manifest, the service worker and the app icons are in place. The debug overlay shows the backend, the frame rate, the draw calls, the triangle count and the body count.
- **Stubbed:** The scene is a test scene that drops crates onto a plate. Milestone 2 replaces it.
- **Test on a phone:** Run `npm run dev -- --host`, open the network address with `?debug` appended, and check that the crates fall and the overlay reports about 60 frames per second.

## Licence

Clearway is free software under the GNU General Public License v3.0 or later. See [LICENSE](LICENSE). The fonts use the SIL Open Font License 1.1.
